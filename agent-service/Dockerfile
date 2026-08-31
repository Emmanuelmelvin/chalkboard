FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --only=production
COPY . .
RUN npm run build
EXPOSE 8080
CMD ["node", "dist/index.js"]
