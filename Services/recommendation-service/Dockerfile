FROM node:20-slim

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# No runtime dependencies, so no install step.
COPY shared/tenancy/src ./shared/tenancy/src
COPY shared/constants/src ./shared/constants/src
COPY shared/constants/package.json ./shared/constants/package.json
COPY shared/tenancy/package.json ./shared/tenancy/package.json

WORKDIR /app/recommendation-service
COPY recommendation-service ./
RUN npm ci && npx prisma generate
RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "src/index.js"]