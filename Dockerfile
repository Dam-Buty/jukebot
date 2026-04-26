# syntax=docker/dockerfile:1.7

# ============================================================================
# Build stage : compile TypeScript et installe les deps natives (node-gyp).
# ============================================================================
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Build deps pour les modules natifs (@discordjs/opus). On reste sur Debian
# plutôt qu'Alpine pour éviter les surprises musl avec node-gyp.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Re-install sans dev-deps pour le runtime stage.
RUN npm ci --omit=dev


# ============================================================================
# Runtime stage : Node + ffmpeg + yt-dlp, image figée pour la prod.
# ============================================================================
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# yt-dlp est livré comme zipapp Python (architecture-agnostic) ; ffmpeg vient
# du repo Debian. curl est installé puis purgé pour limiter la surface.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        ca-certificates \
        curl \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Utilisateur non-root.
RUN groupadd --system jukebot \
    && useradd --system --gid jukebot --create-home --home-dir /home/jukebot jukebot

WORKDIR /app
RUN mkdir -p /app/data && chown -R jukebot:jukebot /app

COPY --from=build --chown=jukebot:jukebot /app/node_modules ./node_modules
COPY --from=build --chown=jukebot:jukebot /app/dist          ./dist
COPY --from=build --chown=jukebot:jukebot /app/package.json  ./package.json

USER jukebot

# data/state.json doit survivre aux restarts → volume monté par compose.
VOLUME ["/app/data"]

CMD ["node", "dist/main.js"]
