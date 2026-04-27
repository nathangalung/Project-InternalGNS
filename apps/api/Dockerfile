FROM golang:1.26-alpine AS build
WORKDIR /src

RUN apk add --no-cache ca-certificates tzdata git

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

COPY . .

ARG VERSION=dev
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build \
        -ldflags "-s -w -X main.version=${VERSION}" \
        -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app

COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/api /app/api

USER nonroot:nonroot
ENV TZ=Asia/Jakarta
EXPOSE 8080

ENTRYPOINT ["/app/api"]
