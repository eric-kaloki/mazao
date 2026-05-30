// Package main — main.go
// Entry point for MazaoPlus. Wires together: in-memory store, background agent,
// Gin HTTP router, and the embedded Vite frontend (served from memory).
package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// frontend holds the compiled Vite build assets baked into the binary.
// The `all:` prefix ensures hidden files and nested dirs are included.
//
//go:embed all:client/dist
var frontend embed.FS

func main() {
	// ---- Initialise core components -----------------------------------------
	store := NewStore()
	store.SeedDemoData()

	handlers := NewHandlers(store)

	// ---- Launch background agent goroutine -----------------------------------
	// This is the heart of MazaoPlus — runs independently forever.
	go StartMonitoring(store)

	// ---- Configure Gin router -----------------------------------------------
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// CORS — permissive for Hack Day (Vite dev server runs on a different port)
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
	}))

	// ---- API routes ----------------------------------------------------------
	v1 := router.Group("/api/v1")
	{
		v1.GET("/health", handlers.HealthHandler)

		// Receipts
		v1.POST("/receipts", handlers.CreateReceiptHandler)
		v1.GET("/receipts/farmer/:id", handlers.GetFarmerReceiptsHandler)

		// Loans
		v1.POST("/loans/apply", handlers.ApplyForLoanHandler)

		// Market
		v1.GET("/market/status", handlers.GetMarketStatusHandler)

		// SSE — real-time agent log stream
		v1.GET("/logs/stream", handlers.StreamLogsHandler)
	}

	// ---- Serve embedded frontend --------------------------------------------
	// Strip the "client/dist" prefix so the FS root maps to the web root.
	distFS, err := fs.Sub(frontend, "client/dist")
	if err != nil {
		log.Fatalf("failed to sub embed FS: %v", err)
	}

	fileServer := http.FileServer(http.FS(distFS))

	// Serve static assets and fall back to index.html for SPA client-side routing.
	router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// If path has a file extension, try to serve it as a static asset
		if strings.Contains(path, ".") {
			c.Request.URL.Path = path
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}

		// All other routes → serve index.html (SPA routing handled by React)
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
	})

	// ---- Start server -------------------------------------------------------
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🌱 MazaoPlus server starting on http://localhost:%s", port)
	log.Printf("📦 Frontend embedded from client/dist — serving SPA from memory")
	log.Printf("🤖 Autonomous market agent running in background")

	if err := router.Run(":" + port); err != nil {
		log.Fatalf("server failed to start: %v", err)
	}
}
