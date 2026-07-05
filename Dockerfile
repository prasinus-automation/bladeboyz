# BladeBoyz — single container serving the static client bundle AND the
# multiplayer WebSocket server from one Node process on one port
# (docs/networking/01 §1: "WS upgrade goes through the same HTTP listener
# that already serves the static client bundle"). Replaces the previous
# nginx static-only image.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
ENV PORT=80
EXPOSE 80
# Supabase auth verification is optional: pass SUPABASE_URL +
# SUPABASE_ANON_KEY at runtime to enable it; otherwise guests only.
CMD ["node", "dist-server/index.mjs"]
