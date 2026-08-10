FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json* ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV DISPLAY_NUMBER=99
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends x11vnc \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY LICENSE ./LICENSE
COPY docker/server-entrypoint.sh ./docker/server-entrypoint.sh
RUN mkdir -p /app/data /app/.runtime \
    && chmod +x /app/docker/server-entrypoint.sh \
    && chown -R pwuser:pwuser /app
USER pwuser
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD kill -0 1 || exit 1
ENTRYPOINT ["/app/docker/server-entrypoint.sh"]
CMD ["node", "dist/index.js"]
