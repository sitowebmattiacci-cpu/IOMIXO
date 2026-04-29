.PHONY: help up down build logs ps shell-backend shell-frontend shell-db dev-backend dev-frontend

# ── Default ────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  IOMIXO — Local Dev Commands"
	@echo "  ────────────────────────────────────────────────────"
	@echo "  make up              Start all services (Docker)"
	@echo "  make up-no-gpu       Start without GPU (Mac / no CUDA)"
	@echo "  make down            Stop all services"
	@echo "  make build           Rebuild all images"
	@echo "  make logs            Follow all logs"
	@echo "  make logs-backend    Follow backend logs"
	@echo "  make logs-frontend   Follow frontend logs"
	@echo "  make ps              Show running containers"
	@echo "  make shell-backend   Open shell in backend container"
	@echo "  make shell-db        Open psql in postgres container"
	@echo "  make dev-backend     Run backend in local dev mode (ts-node-dev)"
	@echo "  make dev-frontend    Run frontend in local dev mode (next dev)"
	@echo "  make typecheck       TypeScript check (backend + frontend)"
	@echo "  make db-reset        Drop & recreate database schema"
	@echo ""

# ── Docker stack ───────────────────────────────────────────────
up:
	docker compose -f mashfusion-ai/docker-compose.yml up -d

up-no-gpu:
	docker compose -f mashfusion-ai/docker-compose.yml up -d \
		--scale ai-engine=1 \
		$(shell docker compose -f mashfusion-ai/docker-compose.yml config --services | \
		  grep -v ai-engine | grep -v celery-worker | \
		  awk '{print ""}')

down:
	docker compose -f mashfusion-ai/docker-compose.yml down

build:
	docker compose -f mashfusion-ai/docker-compose.yml build --no-cache

logs:
	docker compose -f mashfusion-ai/docker-compose.yml logs -f

logs-backend:
	docker compose -f mashfusion-ai/docker-compose.yml logs -f backend

logs-frontend:
	docker compose -f mashfusion-ai/docker-compose.yml logs -f frontend

logs-ai:
	docker compose -f mashfusion-ai/docker-compose.yml logs -f ai-engine celery-worker

ps:
	docker compose -f mashfusion-ai/docker-compose.yml ps

# ── Shells ─────────────────────────────────────────────────────
shell-backend:
	docker compose -f mashfusion-ai/docker-compose.yml exec backend sh

shell-frontend:
	docker compose -f mashfusion-ai/docker-compose.yml exec frontend sh

shell-db:
	docker compose -f mashfusion-ai/docker-compose.yml exec postgres \
		psql -U mashfusion -d mashfusion

# ── Local development (without Docker) ────────────────────────
dev-backend:
	cd mashfusion-ai/backend && npm run dev

dev-frontend:
	cd mashfusion-ai/frontend && npm run dev --cache /tmp/npm-cache-iomixo

# ── Quality ────────────────────────────────────────────────────
typecheck:
	@echo "→ Checking backend…"
	@cd mashfusion-ai/backend && npx tsc --noEmit
	@echo "→ Checking frontend…"
	@cd mashfusion-ai/frontend && npx tsc --noEmit
	@echo "✓ All TypeScript checks passed"

# ── Database ───────────────────────────────────────────────────
db-reset:
	docker compose -f mashfusion-ai/docker-compose.yml exec postgres \
		psql -U mashfusion -d mashfusion -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	docker compose -f mashfusion-ai/docker-compose.yml exec postgres \
		psql -U mashfusion -d mashfusion -f /docker-entrypoint-initdb.d/01_schema.sql
	@echo "✓ Database schema reset"
