FROM node:24-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./

COPY lib/ lib/
COPY artifacts/api-server/ artifacts/api-server/
COPY artifacts/live-streamer/ artifacts/live-streamer/
COPY scripts/ scripts/

RUN pnpm install --frozen-lockfile

RUN PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/live-streamer run build

RUN PORT=8080 pnpm --filter @workspace/api-server run build

FROM node:24-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/artifacts/api-server/dist/ artifacts/api-server/dist/
COPY --from=builder /app/artifacts/live-streamer/dist/public/ artifacts/live-streamer/dist/public/

RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
