# Collaboration & Real-Time Sync

OnSheet uses a **Last-Writer-Wins (LWW)** collaborative model with **Optimistic Concurrency Control (OCC)** at the cell level. There is no CRDT data type — instead, each cell carries a monotonically increasing `version` integer, and the system detects mid-air collisions server-side.

---

## End-to-End Edit Flow

```mermaid
sequenceDiagram
    actor Alice
    actor Bob
    participant GW as CollabGateway
    participant Batch as Batch Buffer (50ms)
    participant DB as PostgreSQL
    participant Redis as Redis PubSub

    Note over Alice,Redis: Alice opens the sheet
    Alice->>GW: sheet:join {sheetId}
    GW->>DB: fetch last 200 CellOperations
    GW-->>Alice: ops:catchup [...]
    GW-->>Alice: sheet:users [Bob, ...]
    GW->>Redis: broadcast user:joined to room

    Note over Alice,Redis: Rapid typing — Alice edits A1 three times
    Alice->>GW: cell:update {row:0, col:0, value:"h"}
    Alice->>GW: cell:update {row:0, col:0, value:"he"}
    Alice->>GW: cell:update {row:0, col:0, value:"hello"}

    GW->>Batch: buffer all three (same row,col)
    Note over Batch: 50ms window expires
    Batch->>Batch: deduplicate → keep only "hello"
    Batch->>DB: CellsService.upsert {rawValue:"hello", baseVersion?}
    DB-->>Batch: cell {version: 5}
    Batch->>Redis: broadcast cell:updated to room (excl. Alice)
    Redis-->>Bob: cell:updated {row:0, col:0, value:"hello", version:5}
    Batch-->>Alice: cell:confirmed {row:0, col:0, version:5}
```

---

## Write Batching

The gateway accumulates `cell:update` events in a per-sheet buffer. A **50 ms timer** fires after the first write in a cycle and flushes the buffer.

```mermaid
flowchart TD
    E1["cell:update (row=2,col=3,'hello')"]
    E2["cell:update (row=5,col=1,'world')"]
    E3["cell:update (row=2,col=3,'hi')"]

    E1 & E2 & E3 -->|"within 50ms"| Buffer["Batch Buffer\nkeyed by sheetId"]

    Buffer --> Dedup["Deduplication\nby (row, col) — last write wins\n\n(row=5,col=1) → 'world'\n(row=2,col=3) → 'hi'  ← event #1 resolved immediately"]

    Dedup -->|"for each cell"| Upsert["DB upsert + op log"]
    Upsert -->|"✓"| BC["broadcast cell:updated to room"]
    BC --> CF["cell:confirmed to sender"]
    Upsert -->|"409 conflict"| CC["cell:conflict to sender"]
```

**Why batch?** Users type character-by-character. Without batching, a single word would create 5+ DB round-trips and 5+ broadcasts. With batching, only the final value is persisted.

---

## Optimistic Concurrency Control (OCC)

Every `Cell` row has a `version` integer. Clients may optionally send `baseVersion` when writing. The server compares it against the current DB version.

```mermaid
sequenceDiagram
    actor Alice
    actor Bob
    participant Server

    Note over Alice,Bob: Both read cell A1 — version is 3

    Alice->>Server: PUT /cells {row:0, col:0, value:"10", baseVersion:3}
    Server->>Server: existing.version(3) === baseVersion(3) ✓
    Server->>Server: new version = 4, upsert
    Server-->>Alice: 200 {version:4}

    Bob->>Server: PUT /cells {row:0, col:0, value:"20", baseVersion:3}
    Server->>Server: existing.version(4) ≠ baseVersion(3) ✗
    Server-->>Bob: 409 {serverCell:{value:"10", version:4}}

    Note over Bob: Client applies LWW merge or prompts user
    Bob->>Server: PUT /cells {row:0, col:0, value:"20", baseVersion:4}
    Server-->>Bob: 200 {version:5}
```

The same logic runs inside the WebSocket write path. On conflict, the server emits `cell:conflict { row, col, serverCell }` so the client can reconcile.

If `baseVersion` is **omitted**, the write is unconditional (no conflict check). Useful for bulk import and AI writes.

---

## Operation Log

Every successful cell write appends a row to `CellOperation`. This is **fire-and-forget** — it never blocks the write path (no `await`).

```mermaid
flowchart LR
    Write["Cell upsert\n(HTTP or WS)"]
    Write -->|"await — blocks response"| DB["cells table\n(upsert)"]
    Write -->|"fire-and-forget"| Log["CellOperation\n(append-only)"]

    Log -->|"on sheet:join"| Catchup["ops:catchup\n(last 200 ops)"]
    Log -->|"on cell:history event"| History["per-cell audit trail\n(newest first)"]
    Log -->|"AI tool"| AIHistory["get_cell_history\nAI tool"]
```

The `CellOperation` table has two indexes:
- `(sheetId, createdAt DESC)` — for catchup queries
- `(sheetId, row, col)` — for per-cell history queries

---

## Late-Joiner Catchup

When a client joins a sheet room, the gateway immediately sends the last **200** operations:

```ts
socket.emit("ops:catchup", recentOps);
```

> **`sinceVersion` — planned but not implemented:** The `sheet:join` payload accepts a `sinceVersion` field and the websockets doc mentions it, but the gateway currently ignores it — it always calls `opLog.getRecent(sheetId, 200)` unconditionally. Incremental reconnect without a full cell-list refetch is the intended future behaviour.

---

## Cursor Sharing

Cursors are ephemeral. No DB writes. The sequence:

1. Client emits `cursor:move { row, col }`
2. Gateway calls `CollabService.updateCursor(sheetId, socketId, { row, col })`
3. Gateway broadcasts `cursor:moved { socketId, row, col }` to the room, excluding the mover

Cursor state is stored in `CollabService`'s in-memory `Map` and is lost on server restart.

---

## Conflict Resolution Strategy Summary

| Scenario | Handling |
|---|---|
| Multiple rapid writes from same user to same cell | 50 ms batch deduplication — last write survives, earlier ones are silently resolved |
| Two users simultaneously editing same cell (detected) | `cell:conflict` emitted with `serverCell`; client must re-merge before retrying |
| Two users editing same cell (no `baseVersion`) | Last write wins unconditionally — no conflict detection |
| Network disconnect + reconnect | Client rejoins room, receives `ops:catchup`, reconciles local state |
| Server restart | Presence reset; cells persisted in DB; client reconnects and re-fetches |
