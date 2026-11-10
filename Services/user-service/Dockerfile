FROM node:20-slim

# PRISMA-ONLY (8 services listed above)
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# END PRISMA-ONLY

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

COPY user-service ./user-service
WORKDIR /app/user-service
RUN npm ci

# PRISMA-ONLY
RUN npx prisma generate
# END PRISMA-ONLY

RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
