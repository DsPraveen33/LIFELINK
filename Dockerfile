# Multi-stage production build for LIFELINK Full-Stack
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace configs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY lib ./lib
COPY artifacts ./artifacts

# Install dependencies and build frontend and backend
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# Runtime Stage
FROM node:20-alpine AS runner

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
