FROM golang:1.27.1-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS build
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
        -o /out/api ./cmd/api && \
    go build -ldflags "-s -w" -o /out/orphan-blobs ./cmd/orphan-blobs

# Runtime needs a XeLaTeX engine for PDF export, so distroless is not viable.
# debian-slim + minimal TeX Live covers the templates' packages and fontspec.
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS runtime
WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
# Upgrade first, so packages the base shipped get their Debian fixes too.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
        texlive-xetex \
        texlive-latex-recommended \
        texlive-latex-extra \
        texlive-fonts-recommended \
        fontconfig \
        ca-certificates \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

# Bundle Plus Jakarta Sans so \setmainfont resolves by name via fontconfig.
COPY --from=build /src/templates/fonts/PlusJakartaSans/*.ttf \
    /usr/local/share/fonts/plusjakartasans/
RUN fc-cache -f

COPY --from=build /out/api /app/api
COPY --from=build /out/orphan-blobs /app/orphan-blobs
COPY --from=build /src/templates /app/templates

# Drop privileges; /tmp stays writable for the LaTeX scratch dir.
RUN useradd --system --no-create-home --uid 10001 appuser
USER appuser

ENV TZ=Asia/Jakarta
EXPOSE 8080

ENTRYPOINT ["/app/api"]
