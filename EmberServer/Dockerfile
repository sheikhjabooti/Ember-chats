# --- build stage ---------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 needs build tools to compile/rebuild its native addon
# for the target platform if a prebuilt binary isn't available.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage ---------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist

# SQLite file lives on a mounted volume so it survives restarts/redeploys.
RUN mkdir -p /data
ENV DATABASE_FILE=/data/ember.db
VOLUME ["/data"]

EXPOSE 4000
CMD ["node", "dist/index.js"]
