# MazaoPlus Makefile
# Usage:
#   make dev    — run both servers concurrently (hot reload)
#   make build  — compile single production binary
#   make run    — run the production binary

.PHONY: dev build run clean

# ---- Development (hot reload) -----------------------------------------------
# Runs Go backend on :8080 and Vite dev server on :5173 concurrently.
# Vite proxies /api/* to the Go backend automatically.
dev:
	@echo "🌱 Starting MazaoPlus development servers..."
	@echo "   Backend  → http://localhost:8080"
	@echo "   Frontend → http://localhost:5173  (hot reload)"
	@(cd client && npm run dev) & \
	 GIN_MODE=debug go run . ; \
	 wait

# ---- Production build -------------------------------------------------------
# 1. Compiles the React SPA into client/dist/
# 2. go build embeds client/dist/ into the binary via //go:embed
build:
	@echo "📦 Building React frontend..."
	cd client && npm run build
	@echo "🔨 Compiling Go binary with embedded frontend..."
	go build -ldflags="-s -w" -o mazaoplus .
	@echo "✅ Build complete → ./mazaoplus"
	@echo "   Run with: ./mazaoplus"
	@ls -lh mazaoplus

# ---- Run production binary --------------------------------------------------
run: build
	@echo "🚀 Starting MazaoPlus on http://localhost:8080"
	./mazaoplus

# ---- Clean ------------------------------------------------------------------
clean:
	rm -f mazaoplus
	rm -rf client/dist
	@echo "🧹 Cleaned build artifacts"
