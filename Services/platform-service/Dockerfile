FROM node:20-slim

WORKDIR /app

# The plan screens import shared/tenancy/src/entitlements.js by relative path.
COPY shared/tenancy/src ./shared/tenancy/src
COPY shared/tenancy/package.json ./shared/tenancy/package.json
COPY platform-service ./platform-service

WORKDIR /app/platform-service
RUN npm ci && npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
