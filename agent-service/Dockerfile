FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source and build TypeScript
COPY src/ ./src/
COPY SYSTEM_INFO.md ./SYSTEM_INFO.md
RUN npm run build && cp SYSTEM_INFO.md dist/SYSTEM_INFO.md

# Production image
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/SYSTEM_INFO.md ./SYSTEM_INFO.md

EXPOSE 8080

CMD ["node", "dist/index.js"]
