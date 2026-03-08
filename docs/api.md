# API Reference

> **Base URL:** `http://localhost:4000/api/v1`  
> All responses are wrapped in `{ "success": true/false, "data": ... }` — see [Architecture](./architecture.md#response-envelope).  
> All routes require JWT (via `accessToken` cookie or `Authorization: Bearer`) unless marked **Public**.

---

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | Liveness check |

**Response:**
```json
{ "success": true, "data": { "status": "ok", "timestamp": "2026-03-08T10:00:00.000Z" } }
```

---

## Auth

Rate limit: **10 req / 60 s** on all `/auth/*` routes.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Create account |
| POST | `/auth/login` | Public | Login |
| POST | `/auth/refresh` | Public | Rotate tokens |
| POST | `/auth/logout` | JWT | Clear session |
| GET | `/auth/me` | JWT | DB user (sensitive fields stripped) |

### `POST /auth/register`

```jsonc
// Body
{ "email": "alice@example.com", "name": "Alice", "password": "secret123" }
// name: 2–80 chars, password: 8–128 chars

// 201
{ "success": true, "data": { "id": "...", "email": "alice@example.com", "displayName": "Alice", "avatarUrl": null, "createdAt": "..." } }
```

### `POST /auth/login`

```jsonc
// Body
{ "email": "alice@example.com", "password": "secret123" }

// 200 — sets Set-Cookie: accessToken + refreshToken (httpOnly)
{ "success": true, "data": { /* safe user */ } }
```

### `POST /auth/refresh`

No body required. Reads `refreshToken` cookie.

```
// 200 — no body (controller returns void); rotates both Set-Cookie headers
{ "success": true, "data": null }
```

### `GET /auth/me`

Returns the user associated with the current JWT (loaded from DB by the JWT strategy, sensitive fields stripped).

```jsonc
// 200
{ "success": true, "data": {
  "id": "user_abc",
  "email": "alice@example.com",
  "displayName": "Alice",
  "avatarUrl": null,
  "createdAt": "2026-03-08T10:00:00.000Z",
  "updatedAt": "2026-03-08T10:00:00.000Z"
} }
// Note: passwordHash and refreshToken are always omitted
```

### `POST /auth/logout`

```jsonc
// 204 — no body; clears cookies + nulls DB refresh token
```

---

## Users

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | JWT | Safe user from DB (no sensitive fields) |
| PATCH | `/users/me` | JWT | Update profile |
| PATCH | `/users/me/password` | JWT | Change password |
| DELETE | `/users/me` | JWT | Delete account (cascades all data) |

### `GET /users/me`

```jsonc
// 200 — passwordHash and refreshToken are always stripped from the response
{ "success": true, "data": {
  "id": "user_abc",
  "email": "alice@example.com",
  "displayName": "Alice",
  "avatarUrl": null,
  "createdAt": "...",
  "updatedAt": "..."
} }
```

### `PATCH /users/me`

```jsonc
// Body (all fields optional)
{ "displayName": "Alice Smith", "avatarUrl": "https://..." }
// displayName: max 80 chars; avatarUrl: must be a valid URL

// 200 — same safe shape as GET /users/me
{ "success": true, "data": { "id": "...", "email": "alice@example.com", "displayName": "Alice Smith", ... } }
```

### `PATCH /users/me/password`

```jsonc
// Body
{ "currentPassword": "secret123", "newPassword": "newSecret456" }
// newPassword: 8–128 chars

// 204 — no body
```

### `DELETE /users/me`

```jsonc
// 204 — no body; cascades all workbooks, sheets, cells, comments, permissions
```

---

## Workbooks

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/workbooks` | JWT | Owned workbooks |
| POST | `/workbooks` | JWT | Create workbook |
| GET | `/workbooks/shared-with-me` | JWT | Workbooks shared via Permission |
| GET | `/workbooks/public/:shareToken` | Public | Public workbook by share token |
| GET | `/workbooks/:id` | JWT | Workbook + sheets + `myRole` |
| PATCH | `/workbooks/:id` | JWT (owner) | Rename |
| DELETE | `/workbooks/:id` | JWT (owner) | Delete (cascades everything) |
| GET | `/workbooks/:id/share-info` | JWT | `{ shareToken, publicAccess }` |
| PATCH | `/workbooks/:id/public-access` | JWT (owner) | Toggle public share link |

### `GET /workbooks`

```jsonc
// 200 — ordered newest first; only workbooks owned by the caller
{ "success": true, "data": [
  {
    "id": "wb_abc", "name": "Q1 Budget", "ownerId": "user_abc",
    "shareToken": null, "publicAccess": false,
    "createdAt": "...", "updatedAt": "...",
    "sheets": [{ "id": "...", "name": "Sheet1", "index": 0 }]
  }
] }
```

### `POST /workbooks`

```jsonc
// Body
{ "name": "Q1 Budget" }
// Automatically creates Sheet1 at index 0

// 201 — includes full sheets array; no myRole in create response
{ "success": true, "data": {
  "id": "wb_abc", "name": "Q1 Budget", "ownerId": "user_abc",
  "shareToken": null, "publicAccess": false,
  "createdAt": "...", "updatedAt": "...",
  "sheets": [{ "id": "...", "name": "Sheet1", "index": 0, "workbookId": "wb_abc", "createdAt": "...", "updatedAt": "..." }]
} }
```

### `GET /workbooks/:id`

```jsonc
// 200 — permissions array stripped; myRole added
{ "success": true, "data": {
  "id": "wb_abc", "name": "Q1 Budget", "ownerId": "user_abc",
  "shareToken": null, "publicAccess": false,
  "createdAt": "...", "updatedAt": "...",
  "sheets": [{ "id": "...", "name": "Sheet1", "index": 0, "workbookId": "wb_abc", "createdAt": "...", "updatedAt": "..." }],
  "myRole": "OWNER"  // "OWNER" for owners; uppercase PermissionRole ("EDITOR","VIEWER","COMMENTER") for collaborators
} }
```

### `PATCH /workbooks/:id`

```jsonc
// Body
{ "name": "Q1 Budget (Final)" }

// 200 — returns updated workbook (no sheets/myRole included)
{ "success": true, "data": {
  "id": "wb_abc", "name": "Q1 Budget (Final)", "ownerId": "user_abc",
  "shareToken": null, "publicAccess": false,
  "createdAt": "...", "updatedAt": "..."
} }
```

### `DELETE /workbooks/:id`

```jsonc
// 200 — returns the deleted workbook record (Prisma delete result)
{ "success": true, "data": { "id": "wb_abc", "name": "Q1 Budget", "ownerId": "...", ... } }
```

### `GET /workbooks/shared-with-me`

```jsonc
// 200 — ordered newest first; workbooks shared via Permission (not owned by caller)
{ "success": true, "data": [
  {
    "id": "wb_xyz", "name": "Team Budget", "ownerId": "user_owner",
    "shareToken": null, "publicAccess": false,
    "createdAt": "...", "updatedAt": "...",
    "sheets": [{ "id": "...", "name": "Sheet1", "index": 0 }],
    "owner": { "id": "user_owner", "email": "owner@example.com", "displayName": "Owner Name", "avatarUrl": null },
    "myRole": "editor"  // always lowercase: "viewer" | "editor" | "commenter"
  }
] }
```

### `GET /workbooks/public/:shareToken`

```jsonc
// 200 — no auth required; returns workbook + sheets
// 404 if shareToken doesn't match or publicAccess is false
{ "success": true, "data": {
  "id": "wb_abc", "name": "Q1 Budget", "ownerId": "...",
  "shareToken": "uuid...", "publicAccess": true,
  "createdAt": "...", "updatedAt": "...",
  "sheets": [{ "id": "...", "name": "Sheet1", "index": 0, "workbookId": "wb_abc", "createdAt": "...", "updatedAt": "..." }]
} }
```

### `GET /workbooks/:id/share-info`

```jsonc
// 200 — accessible to any collaborator or owner
{ "success": true, "data": { "shareToken": "uuid..." , "publicAccess": false } }
// shareToken is null if never toggled on
```

### `PATCH /workbooks/:id/public-access`

```jsonc
// Body
{ "publicAccess": true }

// 200 — returns ONLY shareToken and publicAccess (not the full workbook)
{ "success": true, "data": { "shareToken": "550e8400-...", "publicAccess": true } }
// A UUID shareToken is generated on first enable and reused on subsequent calls
```

---

## Permissions

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/workbooks/:id/permissions` | JWT (owner) | List collaborators |
| POST | `/workbooks/:id/permissions` | JWT (owner) | Grant or update role |
| DELETE | `/workbooks/:id/permissions/:targetUserId` | JWT (owner) | Revoke access |

### `GET /workbooks/:id/permissions`

```jsonc
// 200 — owner only
{ "success": true, "data": [
  { "userId": "...", "email": "bob@example.com", "name": "Bob", "avatarUrl": null, "role": "editor" }
] }
// role is always lowercase: "viewer" | "editor" | "commenter"
```

### `POST /workbooks/:id/permissions`

```jsonc
// Body
{ "email": "bob@example.com", "role": "EDITOR" }
// role accepts lowercase too ("editor") — @Transform uppercases before validation
// Upserts by (workbookId, userId) — re-sharing updates the role

// 201
{ "success": true, "data": { "userId": "...", "email": "bob@example.com", "name": "Bob", "avatarUrl": null, "role": "editor" } }
```

### `DELETE /workbooks/:id/permissions/:targetUserId`

```jsonc
// 200 — returns the deleted Permission record from Prisma
{ "success": true, "data": { "workbookId": "wb_abc", "userId": "user_bob", "role": "EDITOR", "createdAt": "..." } }
```

---

## Sheets

Base: `/workbooks/:workbookId/sheets`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | JWT | List sheets |
| POST | `/` | JWT (editor) | Create sheet |
| GET | `/:id` | JWT | Get sheet |
| PATCH | `/:id` | JWT (editor) | Update name / reorder |
| DELETE | `/:id` | JWT (editor) | Delete sheet |
| GET | `/:id/snapshots` | JWT | List snapshots |
| POST | `/:id/snapshots` | JWT (editor) | Create snapshot |
| POST | `/:id/snapshots/:sid/restore` | JWT (editor) | Restore snapshot |

### `GET /workbooks/:workbookId/sheets`

```jsonc
// 200 — ordered by index asc; returns raw Sheet records
{ "success": true, "data": [
  { "id": "...", "name": "Sheet1", "index": 0, "workbookId": "wb_abc", "createdAt": "...", "updatedAt": "..." }
] }
```

### `GET /workbooks/:workbookId/sheets/:id`

```jsonc
// 200 — returns single Sheet record
{ "success": true, "data": { "id": "...", "name": "Sheet1", "index": 0, "workbookId": "wb_abc", "createdAt": "...", "updatedAt": "..." } }
```

### `PATCH /workbooks/:workbookId/sheets/:id`

```jsonc
// Body (all optional)
{ "name": "Renamed Sheet", "index": 2 }
// index: reorder — caller must manage sibling index consistency

// 200 — returns updated Sheet record
{ "success": true, "data": { "id": "...", "name": "Renamed Sheet", "index": 2, "workbookId": "wb_abc", ... } }
```

### `POST /workbooks/:workbookId/sheets`

```jsonc
// Body (optional)
{ "name": "Sheet2" }
// Auto-names "Sheet{N+1}" if name omitted; index = current count

// 201 — also emits sheet:created WS event to workbook:{workbookId} room
{ "success": true, "data": { "id": "...", "name": "Sheet2", "index": 1, "workbookId": "wb_abc", "createdAt": "...", "updatedAt": "..." } }
```

### `DELETE /workbooks/:workbookId/sheets/:id`

```jsonc
// 200 — also emits sheet:deleted WS event to workbook:{workbookId} room
{ "success": true, "data": { "sheetId": "sheet_abc", "workbookId": "wb_abc" } }
```

### `POST /:id/snapshots/:sid/restore`

Runs inside a **Prisma transaction**: `deleteMany` all current cells → `createMany` from snapshot JSON. Atomic — no partial restore.

```jsonc
// 201
{ "success": true, "data": { "restored": true, "snapshotId": "snap_abc" } }
```

### `POST /workbooks/:workbookId/sheets/:id/snapshots`

```jsonc
// Body (optional)
{ "name": "Before refactor" }
// name defaults to "Autosave" if omitted

// 201 — full SheetSnapshot record including the cells JSON blob
{ "success": true, "data": {
  "id": "snap_abc",
  "sheetId": "sheet_abc",
  "name": "Before refactor",
  "cells": [ /* array of all cell objects at time of snapshot */ ],
  "createdAt": "...",
  "createdBy": "user_abc"
} }
```

### `GET /workbooks/:workbookId/sheets/:id/snapshots`

```jsonc
// 200 — ordered newest first
{ "success": true, "data": [
  {
    "id": "snap_abc",
    "name": "Autosave",
    "createdAt": "2026-03-08T10:00:00.000Z",
    "user": { "id": "...", "displayName": "Alice", "avatarUrl": null }
  }
] }
```

---

## Cells

Base: `/sheets/:sheetId/cells`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | JWT | All cells for sheet |
| PUT | `/` | JWT (editor) | Upsert one cell (with OCC) |
| PUT | `/bulk` | JWT (editor) | Bulk upsert (raw SQL) |
| DELETE | `/?row=N&col=N` | JWT (editor) | Clear one cell |
| GET | `/comments` | JWT | Comments for sheet |
| POST | `/comments` | JWT | Add comment |
| DELETE | `/comments/:id` | JWT | Delete comment (own or editor) |
| GET | `/public/sheets/:shareToken/:sheetId/cells` | Public | Public sheet cells |

### `PUT /sheets/:sheetId/cells` — Single upsert

```jsonc
// Body
{
  "row": 0,
  "col": 0,
  "rawValue": "=SUM(A2:A10)",
  "computed": "55",
  "formatted": "55",
  "style": { "bold": true },
  "baseVersion": 3        // optional — include for conflict detection
}

// 200 — created/updated cell
{ "success": true, "data": { "id": "...", "row": 0, "col": 0, "version": 4, ... } }

// 409 Conflict (baseVersion provided but stale)
{
  "success": false,
  "statusCode": 409,
  "message": "Conflict",
  "serverCell": { "row": 0, "col": 0, "rawValue": "old value", "version": 4 }
}
```

### `PUT /sheets/:sheetId/cells/bulk` — Bulk upsert

```jsonc
// Body — raw JSON array (NOT a wrapped object)
[
  { "row": 0, "col": 0, "rawValue": "Name" },
  { "row": 0, "col": 1, "rawValue": "Score" }
  // ... up to thousands of rows
]

// 200
{ "success": true, "data": { "count": 2 } }
```

Uses raw `INSERT ... ON CONFLICT (sheetId, row, col) DO UPDATE SET ...` SQL. Batched at **3 000 rows** per query (stays under PostgreSQL's 65 535 parameter limit).

### `DELETE /sheets/:sheetId/cells?row=N&col=N` — Clear cell

```jsonc
// 200 — Prisma deleteMany result
{ "success": true, "data": { "count": 1 } }
// count is 0 if the cell didn't exist
```

### `POST /sheets/:sheetId/cells/comments`

```jsonc
// Body
{ "row": 2, "col": 3, "content": "Check this value" }
// content: 1–2000 chars

// 201 — note: updatedAt is NOT included (select excludes it)
{ "success": true, "data": {
  "id": "cmt_abc",
  "row": 2, "col": 3,
  "content": "Check this value",
  "createdAt": "...",
  "user": { "id": "...", "displayName": "Alice", "avatarUrl": null }
} }
```

### `DELETE /sheets/:sheetId/cells/comments/:commentId`

```jsonc
// 200 — owner or any editor of the sheet can delete
// Returns the full deleted CellComment Prisma record
{ "success": true, "data": { "id": "cmt_abc", "sheetId": "...", "row": 2, "col": 3, "content": "...", "createdBy": "user_abc", ... } }
```

### `GET /sheets/:sheetId/cells/comments`

```jsonc
// 200 — ordered by createdAt asc
{ "success": true, "data": [
  {
    "id": "cmt_abc",
    "row": 2, "col": 3,
    "content": "Check this value",
    "createdAt": "...",
    "updatedAt": "...",
    "user": { "id": "...", "displayName": "Alice", "avatarUrl": null }
  }
] }
```

### `GET /public/sheets/:shareToken/:sheetId/cells`

```jsonc
// 200 — no auth; validates shareToken matches workbook and publicAccess === true
// Returns raw cell records for the sheet
{ "success": true, "data": [
  { "id": "...", "sheetId": "...", "row": 0, "col": 0, "rawValue": "Name", "computed": "Name", "formatted": "Name", "style": {}, "version": 1, "createdAt": "...", "updatedAt": "..." }
] }
// 404 if shareToken doesn't match or workbook is not public
```

---

## AI

Rate limit: **20 req / 60 s** on all `/ai/*` routes.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/ai/agent` | JWT | Multi-turn ReAct agent |
| POST | `/ai/formula` | JWT | Formula suggestion |
| POST | `/ai/analyze` | JWT | Data analysis |

### `POST /ai/agent`

```jsonc
// Body
{
  "query": "Find all cells with errors and explain them",
  "sheetId": "sheet_abc",
  "sessionId": "optional-session-id"  // omit to use sheetId as context key
}

// 200
{
  "success": true,
  "data": {
    "answer": "I found 3 cells with #REF! errors...",
    "toolsUsed": ["find_formula_errors", "get_cell_history"],
    "actions": [
      // present when agent called set_cells / delete_cells / add_comment
      // SET_CELLS: cells keyed by A1 notation
      { "type": "SET_CELLS", "cells": { "A1": { "raw": "Name" }, "B1": { "raw": "Score" } } },
      // DELETE_CELLS: same shape with empty raw
      // ADD_COMMENT: { "type": "ADD_COMMENT", "comment": { "row": 2, "col": 3, "content": "..." } }
    ]
  }
}
```

### `POST /ai/formula`

```jsonc
// Body
{ "prompt": "Sum all values in column B", "context": "optional sheet context string" }
// prompt: 1–2000 chars, context: max 10 000 chars
```

### `POST /ai/analyze`

```jsonc
// Body
{ "prompt": "Summarise trends in this sales data", "context": "..." }
```
