FROM node:20-slim

# PRISMA-ONLY (8 services listed above)
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# END PRISMA-ONLY

WORKDIR /app

# Shared packages, in dependency order — assistant-service depends on
# policy-retrieval and contracts (contracts carries the Management copilot
# wire schemas).
COPY shared/policy-retrieval ./shared/policy-retrieval
COPY shared/contracts ./shared/contracts
# No runtime dependencies, so no install step.
COPY shared/tenancy/src ./shared/tenancy/src
COPY shared/constants/src ./shared/constants/src
COPY shared/constants/package.json ./shared/constants/package.json
COPY shared/tenancy/package.json ./shared/tenancy/package.json
RUN npm ci --prefix ./shared/policy-retrieval \
    && npm ci --prefix ./shared/contracts

COPY assistant-service ./assistant-service
WORKDIR /app/assistant-service
RUN npm ci

# PRISMA-ONLY
RUN npx prisma generate
# END PRISMA-ONLY

RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
