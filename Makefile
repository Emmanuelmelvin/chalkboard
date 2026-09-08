PYTHON := $(shell if [ -f agent-service/.venv/Scripts/python.exe ]; then echo agent-service/.venv/Scripts/python.exe; elif [ -f agent-service/.venv/bin/python ]; then echo agent-service/.venv/bin/python; else echo python; fi)

.PHONY: all dev dev-backend dev-frontend dev-agent install build test help

# Default target: start all three services in dev mode
all: dev

help:
	@echo "Chalkboard Development Targets:"
	@echo "  make dev          - Start frontend, backend, and agent-service concurrently in dev mode"
	@echo "  make dev-backend  - Start only the backend service in dev mode"
	@echo "  make dev-frontend - Start only the frontend Vite app in dev mode"
	@echo "  make dev-agent    - Start only the Chalkboard Master agent-service in dev mode"
	@echo "  make install      - Install npm dependencies for all services"
	@echo "  make build        - Build all services for production"
	@echo "  make test         - Run test suites across services"

# Start all 3 services concurrently with labeled, color-coded output
dev:
	npx --yes concurrently \
		-n "backend,agent,frontend" \
		-c "blue.bold,magenta.bold,cyan.bold" \
		--kill-others \
		"npm run dev --prefix backend" \
		"$(PYTHON) agent-service/app.py" \
		"npm run dev --prefix frontend"

dev-backend:
	npm run dev --prefix backend

dev-frontend:
	npm run dev --prefix frontend

dev-agent:
	$(PYTHON) agent-service/app.py

install:
	npm install --prefix backend
	$(PYTHON) -m pip install -r agent-service/requirements.txt -r agent-service/requirements/optional/all.txt
	npm install --prefix frontend

build:
	npm run build --prefix backend
	$(PYTHON) -m compileall -q agent-service
	npm run build --prefix frontend

test:
	$(PYTHON) -m pytest agent-service/tests -q
	npm test --prefix backend
