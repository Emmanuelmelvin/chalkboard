FROM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY shared /app/shared
COPY frontend/. .
# Declare build-args that Aeroplane passes as service env so they are consumed
# (vite inlines VITE_* at build time) — avoids "build-args were not consumed" warning
ARG VITE_USERJOT_PROJECT_ID
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_LIVEKIT_URL
ARG VITE_APP_URL
ARG APP_PUBLIC_URL
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ARG VITE_CLIENT_ID
ARG BACKEND_URL
ARG PORT
RUN npm run build
FROM nginx:alpine
ENV BACKEND_URL=http://api:3001
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
# Aeroplane exports static output from /app/frontend/dist (staticOutput: frontend/dist)
# Keep it in the final image so `docker cp ...:/app/frontend/dist/.` succeeds even though
# nginx serves from /usr/share/nginx/html.
COPY --from=build /app/frontend/dist /app/frontend/dist
EXPOSE 80
