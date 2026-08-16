FROM oven/bun:1.3.14-alpine AS build
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1.3.14-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DEGOOG_MCP_CONFIG=/data/mcp.yml
RUN mkdir -p /data
COPY --from=build /src/dist/main.js /app/main.js
EXPOSE 4443
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4443/healthz >/dev/null 2>&1 || exit 1
ENTRYPOINT ["bun", "run", "/app/main.js"]
