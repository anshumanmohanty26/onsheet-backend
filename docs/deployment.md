# Deployment

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Set to `production` for strict cookie settings (`sameSite:none`, `secure:true`) |
| `PORT` | No | `4000` | HTTP server listen port |
| `FRONTEND_URL` | Yes (prod) | `http://localhost:3000` | Allowed CORS origin. In production also allows `www.` prefix automatically |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) |
| `REDIS_URL` | No | — | Full Redis URL (`redis://` or `rediss://` for TLS). Takes precedence over host/port vars |
| `REDIS_HOST` | No | `localhost` | Redis host (used if `REDIS_URL` not set) |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | — | Redis auth password |
| `JWT_ACCESS_SECRET` | Yes | — | HMAC secret for access tokens (min 32 chars recommended) |
| `JWT_REFRESH_SECRET` | Yes | — | HMAC secret for refresh tokens (different from access secret) |
| `GOOGLE_VERTEX_AI_API_KEY` | No | — | Vertex AI API key — takes priority over service account |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | — | Path to GCP service account JSON file |
| `VERTEX_AI_PROJECT` | No | — | GCP project ID |
| `VERTEX_AI_LOCATION` | No | `us-central1` | Vertex AI region |
| `CLOUDINARY_CLOUD_NAME` | No | — | Cloudinary cloud (for future export feature) |
| `CLOUDINARY_API_KEY` | No | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | No | — | Cloudinary API secret |

---

## Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL + Redis via Docker
docker compose -f docker/docker-compose.dev.yml up -d

# 3. Copy and fill environment variables
cp .env.example .env

# 4. Run Prisma migrations
pnpm prisma migrate dev

# 5. Start in watch mode (ts-node + nodemon)
pnpm start:dev
```

API available at: `http://localhost:4000/api/v1`

---

## Docker

### Development (hot-reload)

```bash
docker compose -f docker/docker-compose.dev.yml up
```

Uses `Dockerfile.dev` — mounts source code as a volume for live reloading.

### Production

```bash
docker compose -f docker/docker-compose.yml up --build
```

Uses `Dockerfile.prod` — multi-stage build, compiles TypeScript, runs `node dist/main`.

### Services

| Service | Image | Port |
|---|---|---|
| `app` | `Dockerfile` / `Dockerfile.prod` | `4000` |
| `postgres` | `postgres:16-alpine` | `5432` |
| `redis` | `redis:7-alpine` | `6379` |

---

## Prisma

```bash
# Run pending migrations
pnpm prisma migrate deploy

# Generate Prisma client (after schema changes)
pnpm prisma generate

# Open Prisma Studio (DB browser)
pnpm prisma studio
```

---

## Production Checklist

- [x] `NODE_ENV=production` — enables `sameSite:none; Secure` cookies
- [x] `FRONTEND_URL` set to your actual frontend domain
- [x] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are strong, unique secrets (≥ 32 chars)
- [x] `DATABASE_URL` points to a managed PostgreSQL instance with SSL
- [x] `REDIS_URL` uses `rediss://` (TLS) for managed Redis
- [x] Vertex AI credentials configured (API key or service account)
- [x] CORS origin locked to frontend domain only
- [x] Rate limits reviewed for your expected traffic
- [x] Prisma migrations applied: `pnpm prisma migrate deploy`
- [x] Health endpoint monitored: `GET /api/v1/health`

---

## Available Scripts

```bash
pnpm start          # run compiled dist/main.js
pnpm start:dev      # watch mode (ts source)
pnpm start:prod     # NODE_ENV=production + compiled
pnpm build          # tsc compile to dist/
pnpm prisma migrate dev    # create + apply migration
pnpm prisma migrate deploy # apply existing migrations (CI/prod)
pnpm prisma generate       # regenerate Prisma client
```
