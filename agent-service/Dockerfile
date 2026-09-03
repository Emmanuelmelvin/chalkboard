FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# System ffmpeg: the ffmpeg-static bundled binary is glibc-linked and won't
# run on Alpine (musl); voiceClient falls back to this system binary.
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/SYSTEM_INFO.md ./SYSTEM_INFO.md
EXPOSE 8080
CMD ["node", "dist/index.js"]
