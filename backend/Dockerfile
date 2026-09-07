FROM node:22-alpine AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY shared /app/shared
COPY backend/. .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
# Migrations run programmatically from dist/index.js before accepting traffic
COPY --from=build /app/backend/drizzle ./drizzle
EXPOSE 3001

CMD ["node", "dist/index.js"]