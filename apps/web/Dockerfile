# Build stage uses bun.
FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS build
WORKDIR /src

COPY package.json bun.lockb* bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
RUN bun run build

# Serve stage uses nginx.
FROM nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS runtime

# Every release takes Alpine's current patches: the base tag is rebuilt
# later than fixes land (libexpat, then pcre2), and the release builds this
# stage without cache.
RUN apk upgrade --no-cache

WORKDIR /usr/share/nginx/html

COPY --from=build /src/dist ./
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/healthz || exit 1
