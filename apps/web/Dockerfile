# Build stage uses bun.
FROM oven/bun:1.3-alpine AS build
WORKDIR /src

COPY package.json bun.lockb* bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
RUN bun run build

# Serve stage uses nginx.
FROM nginx:1.27-alpine AS runtime
WORKDIR /usr/share/nginx/html

COPY --from=build /src/dist ./
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://localhost/healthz || exit 1
