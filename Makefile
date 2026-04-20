.PHONY: help dev api-dev web-dev db-up db-down migrate seed test lint

SHELL := /bin/bash

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n",$$1,$$2}'

dev: db-up ## Start DB + MinIO, then run api and web dev servers in parallel
	@( $(MAKE) api-dev & $(MAKE) web-dev & wait )

api-dev: ## Run Go API with live reload (requires `air`, falls back to `go run`)
	@command -v air >/dev/null 2>&1 && cd apps/api && air || (cd apps/api && go run ./cmd/api)

web-dev: ## Run Vite dev server
	cd apps/web && bun run dev

db-up: ## Start Postgres + MinIO locally
	cd infra/dokploy && docker compose up -d postgres minio

db-down: ## Stop local Postgres + MinIO
	cd infra/dokploy && docker compose down

migrate: ## Apply goose migrations
	$(MAKE) -C apps/api migrate-up

seed: ## Load dev seeds (master + samples)
	$(MAKE) -C apps/api seed-dev

test: ## Run tests (api + web typecheck)
	$(MAKE) -C apps/api test
	cd apps/web && bun run typecheck

lint: ## Lint all code
	$(MAKE) -C apps/api lint
	cd apps/web && bun run lint
