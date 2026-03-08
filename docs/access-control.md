# Access Control

## Role Hierarchy

```mermaid
graph TD
    OWNER["OWNER\n━━━━━━━━━━━━━━━━━\n• Full CRUD on workbook\n• Manage permissions (grant/revoke)\n• Toggle public share link\n• All sheet + cell operations\n• Create/restore snapshots"]
    EDITOR["EDITOR\n━━━━━━━━━━━━━━━━━\n• Create / update / delete sheets\n• Upsert + clear cells\n• Bulk import cells\n• Create snapshots\n• Add + delete comments"]
    COMMENTER["COMMENTER\n━━━━━━━━━━━━━━━━━\n• Add comments\n• Delete own comments\n• Read-only cells and sheets"]
    VIEWER["VIEWER\n━━━━━━━━━━━━━━━━━\n• Read all data\n• Add comments (same as COMMENTER in practice)\n• Delete own comments"]
    GUEST["WS Guest (unauthenticated)\n━━━━━━━━━━━━━━━━━\n• Join sheet rooms\n• Move cursor\n• No cell writes"]
    PUBLIC["Public Share Token (no account)\n━━━━━━━━━━━━━━━━━\n• Read cells via share token\n• No WebSocket access"]

    OWNER -->|"includes"| EDITOR
    EDITOR -->|"includes"| COMMENTER
    COMMENTER -->|"includes"| VIEWER
```

---

## Permission Checks

Each route delegates to one of three guard methods on `WorkbooksService`:

| Method | Condition | Used by |
|---|---|---|
| `findOne(id, userId)` | Owner OR any `Permission` row exists | All read routes, `addComment`, own-comment delete |
| `assertEditor(id, userId)` | Owner OR `role = EDITOR` | Sheet write, cell write, snapshot create/restore, others' comment delete |
| `assertOwner` (private) | Must be `ownerId` | Workbook rename/delete, share settings, permission management |

> **Note on comments:** `addComment` and own-comment `deleteComment` use `findOne` (not `assertEditor`). This means VIEWER and COMMENTER have identical effective permissions for commenting — both can add and delete their own comments. The role distinction is enforced only for deleting *others'* comments (requires EDITOR or owner).

```mermaid
flowchart LR
    Route["Authenticated Route"]
    Route --> FindOne{"findOne\n(any access?)"}
    FindOne -->|"owner or permission"| Pass["✓ proceed"]
    FindOne -->|"no match"| F1["403 ForbiddenException"]

    Route2["Write Route"]
    Route2 --> AssertEditor{"assertEditor\n(editor or owner?)"}
    AssertEditor -->|"owner or EDITOR role"| Pass2["✓ proceed"]
    AssertEditor -->|"VIEWER / COMMENTER"| F2["403 ForbiddenException"]

    Route3["Owner-only Route"]
    Route3 --> AssertOwner{"assertOwner\n(is owner?)"}
    AssertOwner -->|"ownerId === userId"| Pass3["✓ proceed"]
    AssertOwner -->|"not owner"| F3["403 ForbiddenException"]
```

---

## Sharing Mechanics

### Explicit sharing (Permission table)

Owner invites collaborator by email via `POST /workbooks/:id/permissions`. This creates or updates a `Permission` row with an assigned role. The workbook then appears under the invitee's `/workbooks/shared-with-me` list.

### Public share link

Owner calls `PATCH /workbooks/:id/public-access` to toggle `publicAccess = true`. This auto-generates a `shareToken` (UUID via `node:crypto` `randomUUID()`) on first enable. Anyone with the token can:

- `GET /workbooks/public/:shareToken` — read workbook metadata
- `GET /public/sheets/:shareToken/:sheetId/cells` — read cells (no auth required)

Disabling public access sets `publicAccess = false` but preserves the `shareToken` for re-enabling later.

---

## WebSocket Guests

On WebSocket connection, `CollabGateway` attempts:

1. JWT from `handshake.auth.token`
2. Cookie `accessToken`
3. Cookie `refreshToken`

If all fail → socket is tagged as a guest (`guestId = "guest_XXXX"`). Guests can:

- Join rooms (`sheet:join`)
- Move cursors (`cursor:move`)

Guests **cannot** emit `cell:update` — the gateway rejects this with `collab:error { message: "Guests cannot edit cells" }`.

---

## `myRole` Field

`GET /workbooks/:id` returns `myRole` on the workbook object:

- `"OWNER"` — if `workbook.ownerId === userId`
- `"EDITOR"` / `"VIEWER"` / `"COMMENTER"` — from `Permission.role` (lowercased in shared-with-me responses)
