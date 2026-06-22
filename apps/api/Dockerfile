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

# Runtime needs a XeLaTeX engine for PDF export, so distroless is not viable.
# debian-slim + minimal TeX Live covers the templates' packages and fontspec.
FROM debian:bookworm-slim
WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
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
COPY --from=build /src/templates /app/templates

# Drop privileges; /tmp stays writable for the LaTeX scratch dir.
RUN useradd --system --no-create-home --uid 10001 appuser
USER appuser

ENV TZ=Asia/Jakarta
EXPOSE 8080

ENTRYPOINT ["/app/api"]
