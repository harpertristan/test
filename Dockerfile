FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm_config_cafile=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev --cache /tmp/play-scout-npm-cache --fetch-retries=0 --fetch-timeout=30000
COPY server.js ./
COPY lib ./lib
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
