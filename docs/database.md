# Database

Provider: **PostgreSQL 16**  
ORM: **Prisma 6** with `@prisma/adapter-pg` driver adapter (preview feature: `driverAdapters`)

---

## Entity Relationship Diagram

```mermaid
erDiagram
    User {
        String id PK "cuid"
        String email UK
        String displayName
        String passwordHash
        String avatarUrl "nullable"
        String refreshToken "nullable — bcrypt hash"
        DateTime createdAt
        DateTime updatedAt
    }

    Workbook {
        String id PK "cuid"
        String name
        String ownerId FK
        String shareToken "nullable, unique — schema default: cuid(); service uses randomUUID() on first enable"
        Boolean publicAccess "default: false"
        DateTime createdAt
        DateTime updatedAt
    }

    Sheet {
        String id PK "cuid"
        String workbookId FK
        String name
        Int index "unique per workbook"
        DateTime createdAt
        DateTime updatedAt
    }

    Cell {
        String id PK "cuid"
        String sheetId FK
        Int row
        Int col
        String rawValue "nullable"
        String computed "nullable"
        String formatted "nullable"
        Json style "default: {}"
        Int version "default: 1 — optimistic concurrency"
        DateTime createdAt
        DateTime updatedAt
    }

    CellOperation {
        String id PK "cuid"
        String cellId "nullable FK"
        String sheetId FK
        Int row
        Int col
        String userId FK
        Int version
        OpType type "UPDATE|CLEAR|STYLE|INSERT_ROW|DELETE_ROW|INSERT_COL|DELETE_COL"
        String oldValue "nullable"
        String newValue "nullable"
        Json metadata "nullable"
        DateTime createdAt
    }

    Permission {
        String id PK "cuid"
        String workbookId FK
        String userId FK
        PermissionRole role "VIEWER|COMMENTER|EDITOR|OWNER"
        DateTime createdAt
        DateTime updatedAt
    }

    SheetSnapshot {
        String id PK "cuid"
        String sheetId FK
        String name "default: Autosave"
        Json cells "full cell array snapshot"
        String createdBy FK
        DateTime createdAt
    }

    CellComment {
        String id PK "cuid"
        String sheetId FK
        Int row
        Int col
        String content
        String createdBy FK
        DateTime createdAt
        DateTime updatedAt
    }

    User ||--o{ Workbook : "owns"
    User ||--o{ Permission : "has"
    User ||--o{ CellOperation : "makes"
    User ||--o{ SheetSnapshot : "creates"
    User ||--o{ CellComment : "writes"
    Workbook ||--o{ Sheet : "contains"
    Workbook ||--o{ Permission : "grants"
    Sheet ||--o{ Cell : "holds"
    Sheet ||--o{ CellOperation : "logs"
    Sheet ||--o{ SheetSnapshot : "snapshots"
    Sheet ||--o{ CellComment : "has"
```

---

## Models

### `User`

- `id` — cuid primary key
- `email` — unique index
- `passwordHash` — bcrypt 12 rounds; never returned to clients
- `refreshToken` — bcrypt hash of the current refresh token; nulled on logout

### `Workbook`

- `shareToken` — unique cuid, generated lazily when public access is toggled on
- `publicAccess` — boolean; public workbooks expose read-only cells via share token

### `Sheet`

- `(workbookId, index)` — unique composite constraint; prevents duplicate tab positions

### `Cell`

- `(sheetId, row, col)` — unique composite constraint; single source of truth per grid coordinate
- `version` — monotonically increasing integer used for optimistic concurrency control
- `style` — arbitrary JSON blob (font, fill, borders, alignment, number format…)
- `rawValue` — what the user typed (e.g. `=SUM(A1:A10)` or `hello`)
- `computed` — formula evaluation result (e.g. `42`)
- `formatted` — display-formatted value (e.g. `$42.00`)

### `CellOperation`

Append-only audit log. Written fire-and-forget (never blocks the response path).

- `(sheetId, createdAt DESC)` — index for fast "recent ops" queries (catchup)
- `(sheetId, row, col)` — index for per-cell history queries

### `Permission`

- `(workbookId, userId)` — unique composite constraint; one role per user per workbook
- Role order: `OWNER > EDITOR > COMMENTER > VIEWER`

### `SheetSnapshot`

- `cells` — JSON array of all cell objects at snapshot time; used for atomic restore
- `(sheetId, createdAt DESC)` — index for listing snapshots

### `CellComment`

- `sheetId` — indexed for per-sheet comment listing

---

## Enums

```prisma
enum PermissionRole {
  VIEWER
  COMMENTER
  EDITOR
  OWNER
}

enum OpType {
  UPDATE
  CLEAR
  STYLE
  INSERT_ROW
  DELETE_ROW
  INSERT_COL
  DELETE_COL
}
```

---

## PrismaService

Extends `PrismaClient`. Uses `PrismaPg` driver adapter backed by a `pg.Pool`.

- `onModuleInit` — connects
- `onModuleDestroy` — disconnects + calls `pool.end()`

Exported from `PrismaModule` which is `@Global()`, making `PrismaService` available everywhere without explicit imports.
