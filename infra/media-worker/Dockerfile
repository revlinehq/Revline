FROM node:22.21.1-trixie-slim@sha256:c3bf4cf764467f1bf9789fde549971a2cf8e720196df6cf3f95bafa590e5f4af

ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/opt/chrome \
    PUPPETEER_SKIP_DOWNLOAD=true \
    BEAT_TRACK_PYTHON=/opt/beat-tracking/bin/python \
    BEAT_TRACK_MODEL_PATH=/opt/models/beat_this-final0.ckpt \
    SCENE_DETECT_PYTHON=/opt/scene-detection/bin/python \
    YT_DLP_PATH=/opt/video-import/bin/yt-dlp \
    MEDIA_WORKER_CONCURRENCY=1 \
    BEAT_TRACK_THREADS=2 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    OMP_THREAD_LIMIT=2 \
    PRODUCER_BROWSER_GPU_MODE=software \
    PRODUCER_ALLOW_SOFTWARE_WEBGPU=true

RUN apt-get update && apt-get install --no-install-recommends -y \
    ca-certificates ffmpeg util-linux python3 python3-venv tini unzip fonts-liberation \
    libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts \
    && apt-get update \
    && npx puppeteer browsers install chrome --install-deps \
    && npx puppeteer browsers install chrome-headless-shell \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/beat-tracking-requirements.txt scripts/scene-detection-requirements.txt scripts/video-import-requirements.txt /opt/requirements/
RUN python3 -m venv /opt/beat-tracking \
    && /opt/beat-tracking/bin/pip install --no-cache-dir -r /opt/requirements/beat-tracking-requirements.txt \
    && python3 -m venv /opt/scene-detection \
    && /opt/scene-detection/bin/pip install --no-cache-dir -r /opt/requirements/scene-detection-requirements.txt \
    && python3 -m venv /opt/video-import \
    && /opt/video-import/bin/pip install --no-cache-dir -r /opt/requirements/video-import-requirements.txt

COPY models/ /opt/models/
COPY tsconfig.json ./
COPY convex ./convex
COPY lib ./lib
COPY scripts ./scripts
COPY public ./public
COPY infra/media-worker ./infra/media-worker
RUN node scripts/install-beat-model.mjs \
    && node scripts/copy-vendor.mjs \
    && node infra/media-worker/runtime-check.mjs

# Installed Chromium is read-only at runtime. Re-owning it here would copy
# another ~698 MB into every image after an application-code change.
RUN mkdir -p /tmp/revline && chown node:node /tmp/revline
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "infra/media-worker/consumer.ts"]
