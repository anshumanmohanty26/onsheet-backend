# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN npm install -g pnpm
WORKDIR /app

COPY package.json ./
COPY prisma ./prisma

RUN pnpm install
RUN pnpm prisma generate

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN npm install -g pnpm
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# ── Stage 3: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production
RUN npm install -g pnpm
WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY prisma ./prisma

RUN pnpm install --prod
RUN pnpm prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/main"]
