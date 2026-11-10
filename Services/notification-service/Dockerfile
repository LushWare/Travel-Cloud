FROM node:20-slim

WORKDIR /app

# Shared packages, in dependency order — see plan step 4 for why all four
# are always copied regardless of which this service actually imports.
COPY shared/constants ./shared/constants
COPY shared/pricing-engine ./shared/pricing-engine
COPY shared/contracts ./shared/contracts
COPY shared/lead-pricing-engine ./shared/lead-pricing-engine
# No runtime dependencies, so no install step.
COPY shared/tenancy/src ./shared/tenancy/src
COPY shared/tenancy/package.json ./shared/tenancy/package.json
RUN npm ci --prefix ./shared/constants \
    && npm ci --prefix ./shared/pricing-engine \
    && npm ci --prefix ./shared/contracts \
    && npm ci --prefix ./shared/lead-pricing-engine

COPY notification-service ./notification-service
WORKDIR /app/notification-service
RUN npm ci

RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
