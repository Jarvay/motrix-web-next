# Multi-stage build for Motrix Next Web Server
#
# Build arguments:
#   USE_USTC_MIRROR   if set to true, replaces Debian apt sources with
#                     mirrors.ustc.edu.cn (useful for building from China)
#   USE_NPM_MIRROR    if set to true, uses npmmirror.com registry for
#                     faster pnpm package downloads from China
#
# Usage:
#   docker build -t motrix-web-next .
#   docker build --build-arg USE_USTC_MIRROR=true --build-arg USE_NPM_MIRROR=true -t motrix-web-next .
#
# Stage 1: Build frontend (Vue.js)
# Stage 2: Build backend (Rust/Axum + aria2)
# Stage 3: Runtime

ARG USE_USTC_MIRROR
ARG USE_NPM_MIRROR

# ── Stage 1: Frontend build ────────────────────────────────────────────
FROM node:22-alpine AS frontend
ARG USE_NPM_MIRROR

ENV CI=true

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
RUN if [ "${USE_NPM_MIRROR}" = "true" ]; then \
        pnpm config set registry https://registry.npmmirror.com; \
    fi && \
    pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm rebuild esbuild

# Copy source and build
COPY . .
RUN VITE_WEB_MODE=1 pnpm run build:web

# ── Stage 2: Backend build ─────────────────────────────────────────────
FROM rust:1.88-slim AS backend
ARG USE_USTC_MIRROR

WORKDIR /app/src-tauri

# Install build dependencies
RUN if [ "${USE_USTC_MIRROR}" = "true" ]; then \
        sed -i "s|deb.debian.org|mirrors.ustc.edu.cn|g" /etc/apt/sources.list.d/debian.sources; \
    fi && \
    apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    curl \
    build-essential \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Pre-create project structure and copy dependency files
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./
RUN mkdir -p src && echo "fn main() {}" > src/main_web.rs && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --no-default-features --features web --bin motrix-web-next --release || true

# Copy actual source and build
COPY src-tauri/ .
RUN cargo build --no-default-features --features web --bin motrix-web-next --release

# ── Stage 3: Runtime ───────────────────────────────────────────────────
FROM debian:bookworm-slim
ARG USE_USTC_MIRROR

WORKDIR /app

# Install runtime dependencies
RUN if [ "${USE_USTC_MIRROR}" = "true" ]; then \
        sed -i "s|deb.debian.org|mirrors.ustc.edu.cn|g" /etc/apt/sources.list.d/debian.sources; \
    fi && \
    apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libgnutls30 \
    libnettle8 \
    libgmp10 \
    libc-ares2 \
    libsqlite3-0 \
    libxml2 \
    libzstd1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy built backend binary
COPY --from=backend /app/src-tauri/target/release/motrix-web-next ./
# Copy all pre-compiled engine binaries (right one picked by arch at runtime)
COPY --from=backend /app/src-tauri/binaries/ ./binaries/
RUN chmod +x ./motrix-web-next && chmod +x ./binaries/*

# Copy built frontend static files
COPY --from=frontend /app/dist ./dist/

# Environment defaults
ENV PORT=22077
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV FRONTEND_DIR=/app/dist
ENV RPC_PORT=29100

EXPOSE ${PORT}

VOLUME ["/data"]

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://${HOST}:${PORT}/api/version || exit 1

ENTRYPOINT ["./motrix-web-next"]