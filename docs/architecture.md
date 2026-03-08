# System Architecture

## High-Level Overview

```mermaid
graph TB
    subgraph Clients
        Browser["Browser / Next.js Client"]
    end

    subgraph Gateway["HTTP + WS Gateway  (port 4000)"]
        direction TB
        API["REST API\n(global prefix: api/v1)"]
        WS["WebSocket Gateway\n(/collab namespace)"]
    end

    subgraph NestJS["NestJS Application"]
        direction TB
        Auth["AuthModule\nJWT + Cookie + Passport"]
        Users["UsersModule"]
        Workbooks["WorkbooksModule"]
        Sheets["SheetsModule"]
        Cells["CellsModule"]
        Perms["PermissionsModule"]
        Collab["CollabModule\nGateway + Service + OpLog"]
        AI["AiModule\nLangGraph ReAct Agent"]
        Jobs["JobsModule\nBullMQ Processors"]
        Health["HealthModule"]
    end

    subgraph Infra["Infrastructure"]
        PG[("PostgreSQL 16\nPrisma ORM")]
        Redis[("Redis\n- WS PubSub\n- AI Context\n- BullMQ")]
        Vertex["Google Vertex AI\nGemini 2.5 Flash"]
    end

    Browser -->|"HTTPS REST"| API
    Browser -->|"WSS"| WS
    API --> Auth & Users & Workbooks & Sheets & Cells & Perms & AI & Health
    WS --> Collab
    Auth & Users & Workbooks & Sheets & Cells & Perms --> PG
    Collab --> PG
    Collab -->|"Redis Adapter\n(multi-instance pub/sub)"| Redis
    AI -->|"Conversation context\nTTL: 2 h"| Redis
    Jobs -->|"Queue broker"| Redis
    AI --> Vertex
```

---

## Module Dependency Graph

```mermaid
graph LR
    App["AppModule\n(global throttler + JWT guard)"]
    App --> Prisma["PrismaModule 🌐\n(global singleton)"]
    App --> Auth["AuthModule"]
    App --> Users["UsersModule"]
    App --> Workbooks["WorkbooksModule"]
    App --> Sheets["SheetsModule"]
    App --> Cells["CellsModule"]
    App --> Perms["PermissionsModule"]
    App --> Collab["CollabModule"]
    App --> AI["AiModule"]
    App --> Jobs["JobsModule"]
    App --> Health["HealthModule"]

    Sheets -->|"uses assertEditor"| Workbooks
    Cells -->|"uses assertEditor"| Workbooks
    Perms -->|"uses assertOwner"| Workbooks
    Collab -->|"uses upsert"| Cells
    AI -->|"uses cells + comments"| Cells
```

> `PrismaModule` is `@Global()` — available to every module without explicit import.

---

## HTTP Request Pipeline

Every inbound HTTP request passes through this chain in order:

```mermaid
flowchart LR
    Req["HTTP Request"]
    Req --> Helmet["Helmet\n(security headers)"]
    Helmet --> ReqId["X-Request-Id\nmiddleware\n(UUID per request)"]
    ReqId --> Cookie["cookie-parser"]
    Cookie --> JWT["JwtAuthGuard\n(global)\nskip if @Public()"]
    JWT --> Throttle["ThrottlerGuard\n(global)"]
    Throttle --> VP["ValidationPipe\nwhitelist: true\nforbidNonWhitelisted: true\ntransform: true\n50 MB body limit"]
    VP --> Handler["Route Handler"]
    Handler --> TI["TransformInterceptor\n{ success: true, data: ... }"]
    TI --> Resp["HTTP Response"]

    Ex["Exception thrown"] --> EF["HttpExceptionFilter\n{ success: false, statusCode, message }"]
    EF --> Resp
```

> `forbidNonWhitelisted: true` means any request body field that is **not declared on the DTO** is rejected with a 400. Unknown fields never reach handlers.

---

## Global Rate Limits

| Bucket | TTL | Limit | Applied to |
|---|---|---|---|
| `default` | 60 s | 300 req | All routes |
| `auth` | 60 s | 10 req | `/auth/*` routes |
| `ai` | 60 s | 20 req | `/ai/*` routes |

---

## Response Envelope

All successful responses are wrapped by `TransformInterceptor`:

```jsonc
{ "success": true, "data": { /* payload */ } }
```

All error responses are shaped by `HttpExceptionFilter`:

```jsonc
{
  "success": false,
  "statusCode": 409,
  "timestamp": "2026-03-08T10:00:00.000Z",
  "path": "/api/v1/sheets/abc/cells",
  "message": "Conflict"
}
```

---

## Horizontal Scaling

```mermaid
graph LR
    C1["Client A"] -->|"WSS"| I1["Instance 1"]
    C2["Client B"] -->|"WSS"| I2["Instance 2"]

    I1 -->|"publish"| Redis[("Redis\nPub/Sub")]
    Redis -->|"subscribe"| I2

    I2 -->|"publish"| Redis
    Redis -->|"subscribe"| I1
```

`RedisIoAdapter` creates two dedicated ioredis clients (one pub, one sub) per app instance. Socket.io rooms and broadcasts work transparently across all instances. Fails hard on startup if Redis is unreachable.

---

## Structured Logging

`nestjs-pino` is used as the NestJS logger (replaces the default `ConsoleLogger`):

- `bufferLogs: true` in `NestFactory.create` — bootstrap logs are buffered until pino is wired in, so no log messages are lost during startup
- All logs are structured JSON in production, pretty-printed in development
- The app logs `OnSheet API running → http://localhost:{PORT}/api/v1` on startup
- A custom `LoggingInterceptor` (`common/interceptors/logging.interceptor.ts`) exists for per-request `METHOD url — Xms` logs but is **not globally registered** — it can be applied per-module as needed

---

## CORS

Configured in `main.ts` with `credentials: true`.

| Environment | Allowed origins |
|---|---|
| `development` | `http://localhost:3000` + `FRONTEND_URL` (if set) |
| `production` | `FRONTEND_URL` only |

**www / non-www auto-pairing:** The app automatically adds the www ↔ non-www counterpart of `FRONTEND_URL` to the allowed origins list. E.g. if `FRONTEND_URL=https://onsheet.app`, then `https://www.onsheet.app` is also allowed — and vice versa. This prevents CORS failures after naked-domain or www redirects.
