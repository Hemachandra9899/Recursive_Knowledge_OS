FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY prisma ./prisma

RUN npm install

COPY apps/api ./apps/api

RUN npx prisma generate --schema=prisma/schema.prisma

WORKDIR /app/apps/api

EXPOSE 8000

CMD ["npm", "run", "dev"]
