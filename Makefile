.PHONY: help setup \
        db-up db-down db-logs db-shell \
        stack-up stack-down stack-logs ps reset \
        migrate migrate-up migrate-status migrate-down migrate-new \
        seed seed-dev check-reconcile schema-dump db-erd db-functions-dump \
        api web dev \
        tidy sqlc \
        build build-api build-web \
        test test-api test-web \
        lint lint-fix fmt types \
        hooks-install hooks-run \
        docker-build docker-build-api docker-build-web \
        orphan-blobs-dry orphan-blobs-purge \
        clean

SHELL        := /bin/bash
DATABASE_URL ?= postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable
COMPOSE_DEV  := docker compose -f compose.dev.yml
COMPOSE_PROD := docker compose -f infra/dokploy/docker-compose.yml --env-file infra/dokploy/.env

API_DIR      := apps/api
WEB_DIR      := apps/web
MIG_DIR      := $(API_DIR)/db/migrations
SEED_DIR     := $(API_DIR)/db/seeds
CHECK_DIR    := $(API_DIR)/db/checks

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | sort \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-20s\033[0m %s\n",$$1,$$2}'

# Local toolchain prep.
setup: ## Prep env, deps, tools
	@command -v go     >/dev/null || { echo "missing: go (need 1.25+)"; exit 1; }
	@command -v bun    >/dev/null || { echo "missing: bun (need 1.3+)"; exit 1; }
	@command -v docker >/dev/null || { echo "missing: docker"; exit 1; }
	@test -f $(API_DIR)/.env || cp $(API_DIR)/.env.example $(API_DIR)/.env
	@test -f $(WEB_DIR)/.env || cp $(WEB_DIR)/.env.example $(WEB_DIR)/.env
	@command -v goose >/dev/null 2>&1 || { \
	  echo "installing goose..."; \
	  go install github.com/pressly/goose/v3/cmd/goose@latest; \
	}
	cd $(API_DIR) && go mod tidy
	cd $(WEB_DIR) && bun install
	@echo "setup done. Next: make seed-dev && make dev"

# Database container lifecycle.
db-up: ## Start postgres only
	$(COMPOSE_DEV) up -d --wait postgres

db-down: ## Stop postgres
	$(COMPOSE_DEV) stop postgres

db-logs: ## Tail postgres logs
	$(COMPOSE_DEV) logs -f --tail=100 postgres

db-shell: ## Open psql shell
	$(COMPOSE_DEV) exec postgres psql -U gns_app -d gns_quotation

db-ui: ## Start pgweb DB browser (http://localhost:8081)
	$(COMPOSE_DEV) up -d --wait pgweb
	@echo ">> pgweb running at http://localhost:8081"

db-ui-down: ## Stop pgweb
	$(COMPOSE_DEV) stop pgweb

# Full dev stack lifecycle.
stack-up: ## Build and start postgres + api
	$(COMPOSE_DEV) up -d --build --wait

stack-down: ## Stop full dev stack
	$(COMPOSE_DEV) down

stack-logs: ## Tail dev stack logs
	$(COMPOSE_DEV) logs -f --tail=100

ps: ## List dev containers
	$(COMPOSE_DEV) ps

reset: ## Wipe dev stack and volumes
	$(COMPOSE_DEV) down -v

# Migrations.
migrate: db-up ## Apply migrations + create superadmin
	cd $(API_DIR) && go run ./cmd/api -bootstrap

migrate-up: db-up ## Apply all pending migrations (raw goose)
	goose -dir $(MIG_DIR) postgres "$(DATABASE_URL)" up

migrate-status: ## Show migration state
	goose -dir $(MIG_DIR) postgres "$(DATABASE_URL)" status

migrate-down: ## Roll back the last migration
	goose -dir $(MIG_DIR) postgres "$(DATABASE_URL)" down

migrate-new: ## Create a new migration NAME=
	@test -n "$(NAME)" || (echo "NAME is required"; exit 1)
	goose -dir $(MIG_DIR) -s create $(NAME) sql

# Seeds.
# stdin redirect (`< $$f`) instead of `-f` is intentional: on Windows,
# `psql -f file.sql` reads the file in the system codepage (cp1252) even
# when PGCLIENTENCODING=UTF8 — multi-byte chars like ×, ®, ″ get expanded
# and trip VARCHAR length checks. Stdin is pure bytes, decoded by the
# client_encoding setting → cross-platform safe.
seed: ## Load master data only (units + countries, idempotent)
	@echo ">> $(SEED_DIR)/01_master.sql"
	@PGCLIENTENCODING=UTF8 psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 < $(SEED_DIR)/01_master.sql

seed-dev: migrate ## Migrate + load master + dev sample data (DEV ONLY)
	@set -e; for f in $(SEED_DIR)/*.sql; do \
	  echo ">> $$f"; \
	  PGCLIENTENCODING=UTF8 psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 < $$f; \
	done

check-reconcile: ## Run reconciliation / verification queries
	psql "$(DATABASE_URL)" -f $(CHECK_DIR)/01_verify_advanced.sql

schema-dump: ## Dump current schema to docs/schema_current.sql
	pg_dump --schema-only --no-owner "$(DATABASE_URL)" > docs/schema_current.sql

# Canonical plpgsql bodies. The drift test is the enforcement; this only
# refreshes the files after a migration changes a function.
db-functions-dump: db-up ## Regenerate db/functions from the live DB
	cd $(API_DIR) && DATABASE_URL="$(DATABASE_URL)" GNS_UPDATE_FUNCTIONS=1 \
	  go test ./db/functions -run TestFunctionBodiesMatchDatabase -count=1

db-erd: db-up ## Regenerate docs/erd from the live dev DB (requires tbls)
	@command -v tbls >/dev/null 2>&1 || { \
	  echo "installing tbls..."; \
	  go install github.com/k1LoW/tbls@latest; \
	}
	tbls doc --force

# Local dev servers.
api: db-up ## Run API on host
	cd $(API_DIR) && go run ./cmd/api

web: ## Run Vite dev server
	cd $(WEB_DIR) && bun run dev

dev: db-up ## Run api and web together
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) api & \
	$(MAKE) web & \
	wait

# Code generation / dependency tidy.
tidy: ## go mod tidy
	cd $(API_DIR) && go mod tidy

sqlc: ## Generate sqlc code
	cd $(API_DIR) && sqlc generate

# Build artifacts.
build: build-api build-web ## Build api binary and web bundle

build-api: ## Build API binary to apps/api/bin/api
	cd $(API_DIR) && go build -o bin/api ./cmd/api

build-web: ## Build FE bundle
	cd $(WEB_DIR) && bun run build

# Tests and checks.
test: test-api test-web ## Run all tests

test-api: ## Run Go unit tests (serialized to avoid godog/integration interference)
	cd $(API_DIR) && go test ./... -race -count=1 -p=1

test-web: ## Typecheck FE
	cd $(WEB_DIR) && bun run typecheck

lint: ## Lint api and web
	cd $(API_DIR) && go vet ./...
	@command -v golangci-lint >/dev/null 2>&1 && (cd $(API_DIR) && golangci-lint run) || echo "golangci-lint not installed, skipping"
	cd $(WEB_DIR) && bun run lint

# Auto-fix every fixable lint + format violation. golangci-lint --fix applies
# the formatters + simple rewrites; biome check --write does the same for FE.
lint-fix: ## Auto-fix lint + format issues (api + web)
	cd $(API_DIR) && gofmt -w -s .
	@command -v golangci-lint >/dev/null 2>&1 && (cd $(API_DIR) && golangci-lint run --fix) || echo "golangci-lint not installed, skipping --fix"
	cd $(WEB_DIR) && bun x @biomejs/biome check --write src

fmt: ## Format api and web
	cd $(API_DIR) && gofmt -w -s .
	cd $(WEB_DIR) && bun run format

types: ## TypeScript typecheck (FE)
	cd $(WEB_DIR) && bun run typecheck

# Pre-commit hooks (.pre-commit-config.yaml). Uses `uv tool` to manage
# the pre-commit binary so the repo stays python-toolchain-free.
hooks-install: ## Install git pre-commit hooks (auto-installs pre-commit via uv)
	@command -v uv >/dev/null 2>&1 || { echo "missing: uv (https://docs.astral.sh/uv/)"; exit 1; }
	@command -v pre-commit >/dev/null 2>&1 || uv tool install pre-commit
	pre-commit install

hooks-run: ## Run all hooks against every file (CI-style sweep)
	@command -v pre-commit >/dev/null 2>&1 || { echo "run: make hooks-install"; exit 1; }
	pre-commit run --all-files

# Container images.
docker-build: docker-build-api docker-build-web ## Build api and web images

docker-build-api: ## Build API image
	docker build -t internalgns-api:local $(API_DIR)

docker-build-web: ## Build FE image
	docker build \
	  --build-arg VITE_API_URL=$${VITE_API_URL:-/api/v1} \
	  -t internalgns-web:local $(WEB_DIR)

# Storage maintenance.
orphan-blobs-dry: ## List MinIO keys not referenced by any DB row (read-only)
	cd $(API_DIR) && go run ./cmd/orphan-blobs --dry-run

orphan-blobs-purge: ## Delete unreferenced MinIO keys older than 60 min
	cd $(API_DIR) && go run ./cmd/orphan-blobs --dry-run=false

# Cleanup.
clean: ## Remove build artifacts
	rm -rf $(API_DIR)/bin
	rm -rf $(WEB_DIR)/dist
	rm -rf $(WEB_DIR)/node_modules/.vite
