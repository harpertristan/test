FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm_config_cafile=/run/secrets/npm_ca; fi; \
    npm ci --ignore-scripts --omit=dev --cache /tmp/play-scout-npm-cache --fetch-retries=0 --fetch-timeout=30000
COPY --chown=node:node server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
EXPOSE 3000
CMD ["node", "--disallow-code-generation-from-strings", "server.js"]
