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
		"npm run dev --prefix agent-service" \
		"npm run dev --prefix frontend"

dev-backend:
	npm run dev --prefix backend

dev-frontend:
	npm run dev --prefix frontend

dev-agent:
	npm run dev --prefix agent-service

install:
	npm install --prefix backend
	npm install --prefix agent-service
	npm install --prefix frontend

build:
	npm run build --prefix backend
	npm run build --prefix agent-service
	npm run build --prefix frontend

test:
	npm test --prefix agent-service
	npm test --prefix backend
