# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:24-slim
WORKDIR /app
# Chromium voor schermafbeeldingen die Claude via MCP opvraagt (WebGL via SwiftShader).
# Blender (headless) om meubels als 3D-model te bouwen; uitzetten met --build-arg WITH_BLENDER=false
# (scheelt ~1 GB). Blender-scripts draaien als aparte gebruiker zonder toegang tot /data.
ARG WITH_BLENDER=true
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core ca-certificates \
 && if [ "$WITH_BLENDER" = "true" ]; then apt-get install -y --no-install-recommends blender python3-numpy; fi \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r -g 990 blender && useradd -r -u 990 -g 990 -M -d /nonexistent -s /usr/sbin/nologin blender
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8787 \
    CHROME_PATH=/usr/bin/chromium \
    BLENDER_UID=990 \
    BLENDER_GID=990
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
COPY src/shared ./src/shared
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server/index.ts"]
