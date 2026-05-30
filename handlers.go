// Package main — handlers.go
// Thin Gin HTTP handlers. Each handler delegates immediately to the store —
// no business logic lives here beyond request parsing and response shaping.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Handlers bundles the store dependency for all HTTP handler methods.
type Handlers struct {
	store *Store
}

// NewHandlers constructs a Handlers instance.
func NewHandlers(store *Store) *Handlers {
	return &Handlers{store: store}
}

// ---- Receipt Handlers --------------------------------------------------------

// CreateReceiptHandler handles POST /api/v1/receipts
// Warehouse manager logs an incoming cereal deposit.
func (h *Handlers) CreateReceiptHandler(c *gin.Context) {
	var req ReceiptCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Default grade info if not provided
	if req.GradeInfo == "" {
		req.GradeInfo = "Grade 1"
	}

	receipt := h.store.CreateReceipt(req)

	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogInfo,
		Message: fmt.Sprintf(
			"🌽 New receipt minted | ID: %s | Farmer: %s | %d bags of %s | Grade: %s",
			receipt.ID[:8], receipt.FarmerID, receipt.QuantityBags, receipt.CommodityType, receipt.GradeInfo,
		),
	})

	c.JSON(http.StatusCreated, receipt)
}

// GetFarmerReceiptsHandler handles GET /api/v1/receipts/farmer/:id
// Returns all receipts for a given farmer, enriched with current market values.
func (h *Handlers) GetFarmerReceiptsHandler(c *gin.Context) {
	farmerID := c.Param("id")
	if farmerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "farmer id is required"})
		return
	}

	receipts := h.store.GetReceiptsByFarmer(farmerID)
	price := h.store.GetMarketPrice()

	// Enrich each receipt with market valuation data
	type EnrichedReceipt struct {
		*ProduceReceipt
		MarketValueKES float64  `json:"market_value_kes"`
		MaxLoanKES     float64  `json:"max_loan_kes"`
		CurrentPriceKES float64 `json:"current_price_kes"`
		ActiveLoan     *Loan    `json:"active_loan,omitempty"`
	}

	enriched := make([]EnrichedReceipt, 0, len(receipts))
	for _, r := range receipts {
		marketVal := float64(r.QuantityBags) * price.CurrentPrice
		loan, _ := h.store.GetLoanByReceipt(r.ID)
		enriched = append(enriched, EnrichedReceipt{
			ProduceReceipt:  r,
			MarketValueKES:  marketVal,
			MaxLoanKES:      marketVal * 0.60,
			CurrentPriceKES: price.CurrentPrice,
			ActiveLoan:      loan,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"farmer_id": farmerID,
		"receipts":  enriched,
		"count":     len(enriched),
	})
}

// ---- Loan Handlers -----------------------------------------------------------

// ApplyForLoanHandler handles POST /api/v1/loans/apply
// Farmer applies for a 60% LTV asset-backed micro-loan.
// This atomically locks the underlying receipt and records the loan.
func (h *Handlers) ApplyForLoanHandler(c *gin.Context) {
	var req LoanApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify receipt ownership and availability
	receipt, ok := h.store.GetReceipt(req.ReceiptID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "receipt not found"})
		return
	}
	if receipt.FarmerID != req.FarmerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "receipt does not belong to this farmer"})
		return
	}
	if receipt.Status != StatusAvailable {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "receipt is not available for collateral",
			"current_status": receipt.Status,
		})
		return
	}

	// Check for existing active loan on this receipt
	if _, exists := h.store.GetLoanByReceipt(req.ReceiptID); exists {
		c.JSON(http.StatusConflict, gin.H{"error": "an active loan already exists for this receipt"})
		return
	}

	// Calculate 60% LTV against current market price
	price := h.store.GetMarketPrice()
	marketValue := float64(receipt.QuantityBags) * price.CurrentPrice
	principal := marketValue * 0.60

	// State transition: AVAILABLE → LOCKED_COLLATERAL
	if err := h.store.LockReceipt(req.ReceiptID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	loan := h.store.CreateLoan(req.ReceiptID, req.FarmerID, principal)

	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogInfo,
		Message: fmt.Sprintf(
			"💰 LOAN ISSUED | Farmer: %s | Receipt: %s | Market Value: KES %.2f | Principal (60%% LTV): KES %.2f",
			req.FarmerID, req.ReceiptID[:8], marketValue, principal,
		),
	})
	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogPayout,
		Message: fmt.Sprintf(
			"💸 M-PESA B2C DISBURSEMENT | Farmer: %s | KES %.2f | Status: INSTANT_CREDIT_APPLIED",
			req.FarmerID, principal,
		),
	})

	c.JSON(http.StatusCreated, LoanApplicationResponse{
		Loan:          *loan,
		DisbursedKES:  principal,
		MarketValueAt: marketValue,
		LTVPercent:    60,
	})
}

// ---- Market Status Handler ---------------------------------------------------

// GetMarketStatusHandler handles GET /api/v1/market/status
// Returns the current simulated market price and 30-tick history for charting.
func (h *Handlers) GetMarketStatusHandler(c *gin.Context) {
	price := h.store.GetMarketPrice()
	c.JSON(http.StatusOK, price)
}

// ---- SSE Log Stream Handler --------------------------------------------------

// StreamLogsHandler handles GET /api/v1/logs/stream
// Establishes a Server-Sent Events connection. Sends historical logs first,
// then streams new agent log entries in real-time as they are emitted.
func (h *Handlers) StreamLogsHandler(c *gin.Context) {
	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // disable nginx proxy buffering

	// Create a per-client channel and register it with the store
	clientChan := make(chan AgentLogEntry, 64)
	h.store.AddLogListener(clientChan)

	// Ensure cleanup when the client disconnects
	defer func() {
		h.store.RemoveLogListener(clientChan)
		close(clientChan)
	}()

	// Flush historical logs first so a freshly opened browser tab catches up
	historical := h.store.GetLogs()
	for _, entry := range historical {
		data, _ := json.Marshal(entry)
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
	}
	c.Writer.Flush()

	// Stream new entries as they arrive
	clientGone := c.Request.Context().Done()
	for {
		select {
		case <-clientGone:
			return
		case entry, ok := <-clientChan:
			if !ok {
				return
			}
			data, err := json.Marshal(entry)
			if err != nil {
				continue
			}
			_, err = fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			if err != nil {
				return
			}
			if flusher, ok := c.Writer.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
}

// ---- Health Check ------------------------------------------------------------

// HealthHandler handles GET /api/v1/health
func (h *Handlers) HealthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"service":   "MazaoPlus",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// ensure io is imported for potential future use (e.g., request body logging)
var _ = io.Discard
