# Multi-stage production build for LIFELINK Full-Stack
FROM node:20 AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy all project configuration and source trees
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY attached_assets ./attached_assets
COPY scripts ./scripts

# Install dependencies for Linux environment
RUN pnpm install --no-frozen-lockfile

# Limit memory to 384MB so it comfortably fits Render 512MB free tier
ENV NODE_OPTIONS="--max-old-space-size=384"

# Build frontend and backend
RUN pnpm run build

# Runtime Stage
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Copy build artifacts and dependencies
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/lifelink/dist ./artifacts/lifelink/dist

EXPOSE 5000

CMD ["node", "artifacts/api-server/dist/index.mjs"]
