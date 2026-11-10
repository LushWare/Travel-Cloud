FROM node:20-slim

# PRISMA-ONLY (voice-service runs Prisma against Supabase Postgres)
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# END PRISMA-ONLY

WORKDIR /app

# Shared agency (tenant) filter.
# No runtime dependencies, so no install step.
COPY shared/tenancy/src ./shared/tenancy/src
COPY shared/constants/src ./shared/constants/src
COPY shared/constants/package.json ./shared/constants/package.json
COPY shared/tenancy/package.json ./shared/tenancy/package.json
COPY voice-service ./voice-service
WORKDIR /app/voice-service
RUN npm ci

# PRISMA-ONLY
RUN npx prisma generate
# END PRISMA-ONLY

RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
