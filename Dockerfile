# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM deps AS build

WORKDIR /app

COPY . .
RUN npm run build

FROM node:22-alpine AS prod-deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5100 \
    AI_GW_SERVE_FRONTEND=true \
    AI_GW_PUBLIC_BASE_URL=https://1024012.xyz

COPY --from=prod-deps --chown=node:node /app/package*.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/*.mjs ./backend/
COPY --from=build --chown=node:node /app/backend/shortcuts/*.signed ./backend/shortcuts/
COPY --from=build --chown=node:node /app/backend/gateway.config.example.json ./backend/gateway.config.example.json
COPY --from=build --chown=node:node /app/dist ./dist

RUN mkdir -p /app/backend/data && chown -R node:node /app

USER node

EXPOSE 5100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const port=process.env.PORT||5100;fetch('http://127.0.0.1:'+port+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.mjs"]
