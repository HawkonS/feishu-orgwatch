FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV ORGWATCH_WORKSPACE=/state

COPY --chown=node:node --from=build /app /app
RUN mkdir -p /state && chown -R node:node /state
USER node
VOLUME ["/state"]
EXPOSE 18080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ORGWATCH_APP_PORT||18080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bash", "/app/run.sh", "--no-build"]
