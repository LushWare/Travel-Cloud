FROM node:20-slim

WORKDIR /app

COPY shared/tenancy/src ./shared/tenancy/src
COPY shared/tenancy/package.json ./shared/tenancy/package.json
COPY integration-service ./integration-service

WORKDIR /app/integration-service
RUN npm ci && npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
