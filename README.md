# OnSheet — Backend

> NestJS REST + WebSocket API powering **OnSheet**, a real-time collaborative spreadsheet application.

## Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10 + TypeScript |
| Database | PostgreSQL 16 via Prisma 6 |
| Cache / PubSub / Queues | Redis (ioredis) |
| WebSockets | Socket.io + `@socket.io/redis-adapter` |
| Auth | Passport — Local + JWT (httpOnly cookies) |
| Queue Workers | BullMQ |
| AI | LangChain + LangGraph + Google Vertex AI (Gemini 2.5 Flash) |
| Global prefix | `api/v1` — Default port `4000` |

## Getting Started

```bash
# Install dependencies
pnpm install

# Start PostgreSQL + Redis
docker compose -f docker/docker-compose.dev.yml up -d

# Apply migrations
pnpm prisma migrate dev

# Start in watch mode
pnpm start:dev
```

## Documentation

All detailed documentation lives in the [`docs/`](./docs/) folder:

| Document | Description |
|---|---|
| [Architecture](./docs/architecture.md) | System overview, module graph, request pipeline |
| [Database](./docs/database.md) | Prisma schema, ER diagram, key constraints |
| [Authentication](./docs/auth.md) | JWT + cookie strategy, token lifecycle, guards |
| [Access Control](./docs/access-control.md) | RBAC model — OWNER / EDITOR / COMMENTER / VIEWER |
| [API Reference](./docs/api.md) | All HTTP endpoints with payloads and auth requirements |
| [WebSocket Events](./docs/websockets.md) | Full Socket.io event reference (`/collab` namespace) |
| [Collaboration](./docs/collaboration.md) | Real-time sync, write batching, OCC, conflict resolution |
| [AI Agent](./docs/ai.md) | LangGraph ReAct agent, tools, conversation context |
| [Background Jobs](./docs/jobs.md) | BullMQ export/import queue processors |
| [Deployment](./docs/deployment.md) | Environment variables, Docker, production checklist |
