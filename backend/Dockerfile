FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Migrations run from this image (one-off job) before a deploy accepts traffic.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
EXPOSE 3001

# Env vars come from the platform (Aeroplane), not from a .env file. The worker
# is the same image started with PROCESS_TYPE=worker.
CMD ["node", "dist/index.js"]