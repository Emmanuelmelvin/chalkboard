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
# Migrations run programmatically from dist/index.js before accepting traffic
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3001

CMD ["node", "dist/index.js"]