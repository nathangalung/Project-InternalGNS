# Build stage uses bun.
FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS build
WORKDIR /src

COPY package.json bun.lockb* bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
RUN bun run build

# Serve stage uses nginx.
FROM nginx:1.30.5-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS runtime

# Base ships vulnerable libexpat; tags not rebuilt yet.
RUN apk upgrade --no-cache libexpat

WORKDIR /usr/share/nginx/html

COPY --from=build /src/dist ./
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/healthz || exit 1
