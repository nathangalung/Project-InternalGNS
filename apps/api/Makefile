.PHONY: help tidy build run test lint fmt sqlc \
        migrate-up migrate-down migrate-status migrate-new \
        seed-dev check-reconcile schema-dump docker-build

SHELL := /bin/bash
DATABASE_URL ?= postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable
MIG_DIR      := migrations
SEED_DIR     := migrations/seeds
CHECK_DIR    := migrations/checks

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-22s\033[0m %s\n",$$1,$$2}'

tidy: ## go mod tidy
	go mod tidy

build: ## Build binary to ./bin/api
	go build -o bin/api ./cmd/api

run: ## Run the API locally
	go run ./cmd/api

test: ## Run unit tests
	go test ./... -race -count=1

lint: ## Run go vet + golangci-lint if installed
	go vet ./...
	@command -v golangci-lint >/dev/null 2>&1 && golangci-lint run || echo "golangci-lint not installed, skipping"

fmt: ## Format code
	gofmt -w -s .

sqlc: ## Generate sqlc code
	sqlc generate

migrate-up: ## Apply all pending migrations
	goose -dir $(MIG_DIR) postgres "$(DATABASE_URL)" up

migrate-down: ## Roll back the last migration
	goose -dir $(MIG_DIR) postgres "$(DATABASE_URL)" down

migrate-status: ## Show migration status
	goose -dir $(MIG_DIR) postgres "$(DATABASE_URL)" status

migrate-new: ## Create a new migration file. Usage: make migrate-new NAME=add_payments
	@test -n "$(NAME)" || (echo "NAME is required"; exit 1)
	goose -dir $(MIG_DIR) -s create $(NAME) sql

seed-dev: ## Load master + dev sample data (DEV ONLY)
	@for f in $(SEED_DIR)/*.sql; do \
	  echo ">> $$f"; \
	  psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f $$f; \
	done

check-reconcile: ## Run reconciliation / verification queries
	psql "$(DATABASE_URL)" -f $(CHECK_DIR)/01_verify_advanced.sql

schema-dump: ## Dump current schema to docs/schema_current.sql
	pg_dump --schema-only --no-owner "$(DATABASE_URL)" > ../../docs/schema_current.sql

docker-build: ## Build API Docker image
	docker build -t internalgns-api:local .
