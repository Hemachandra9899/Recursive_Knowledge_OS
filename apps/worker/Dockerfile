FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/queue/package.json ./packages/queue/package.json
COPY packages/clients/package.json ./packages/clients/package.json
COPY packages/retrieval/package.json ./packages/retrieval/package.json
COPY packages/knowledge/package.json ./packages/knowledge/package.json
COPY prisma ./prisma

RUN npm install

COPY apps/worker ./apps/worker
COPY packages/database ./packages/database
COPY packages/queue ./packages/queue
COPY packages/clients ./packages/clients
COPY packages/retrieval ./packages/retrieval
COPY packages/knowledge ./packages/knowledge

RUN npx prisma generate --schema=prisma/schema.prisma

WORKDIR /app/apps/worker

CMD ["npm", "run", "start"]
