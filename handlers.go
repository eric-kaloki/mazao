// Package main — handlers.go
// Thin Gin HTTP handlers. Each handler delegates immediately to the store —
// no business logic lives here beyond request parsing and response shaping.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
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
// PriceAtDeposit is captured from the live market price at the moment of entry.
func (h *Handlers) CreateReceiptHandler(c *gin.Context) {
	var req ReceiptCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.GradeInfo == "" {
		req.GradeInfo = "Grade 1"
	}

	// Capture the market price NOW — this becomes the frozen deposit price
	price := h.store.GetMarketPrice()
	receipt := h.store.CreateReceipt(req, price.CurrentPrice)

	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogInfo,
		Message: fmt.Sprintf(
			"🌽 Receipt minted | ID: %s | Farmer: %s | %d bags %s | Entry price: KES %.2f/bag | Deposit value: KES %.2f",
			receipt.ID[:8], receipt.FarmerID, receipt.QuantityBags,
			receipt.CommodityType, receipt.PriceAtDeposit, receipt.DepositValueKES,
		),
	})

	c.JSON(http.StatusCreated, receipt)
}

// GetFarmerReceiptsHandler handles GET /api/v1/receipts/farmer/:id
// Returns all receipts for a given farmer.
// AVAILABLE receipts are enriched with the live market price for display.
// LOCKED receipts show their fixed loan amount — NOT recalculated from live price.
func (h *Handlers) GetFarmerReceiptsHandler(c *gin.Context) {
	rawID := c.Param("id")
	farmerID := strings.ToUpper(strings.TrimSpace(rawID))
	if farmerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "farmer id is required"})
		return
	}

	receipts := h.store.GetReceiptsByFarmer(farmerID)
	currentMarket := h.store.GetMarketPrice()

	// EnrichedReceipt augments the base receipt with computed financial fields.
	type EnrichedReceipt struct {
		*ProduceReceipt
		// CurrentMarketValueKES: bags × live price (informational only for AVAILABLE)
		CurrentMarketValueKES float64 `json:"current_market_value_kes"`
		// MaxLoanKES: 60% of DepositValueKES — the fixed, entry-price-based loan ceiling
		MaxLoanKES float64 `json:"max_loan_kes"`
		// CurrentPriceKES: live market price (for the chart/display)
		CurrentPriceKES float64 `json:"current_price_kes"`
		// ActiveLoan: populated if a loan exists and is not settled
		ActiveLoan *Loan `json:"active_loan,omitempty"`
	}

	enriched := make([]EnrichedReceipt, 0, len(receipts))
	for _, r := range receipts {
		liveMarketVal := float64(r.QuantityBags) * currentMarket.CurrentPrice
		loan, _ := h.store.GetLoanByReceipt(r.ID)
		enriched = append(enriched, EnrichedReceipt{
			ProduceReceipt:        r,
			CurrentMarketValueKES: liveMarketVal,
			// MaxLoanKES is always derived from the frozen deposit value, never live price
			MaxLoanKES:      r.DepositValueKES * 0.60,
			CurrentPriceKES: currentMarket.CurrentPrice,
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
// Issues a 60% LTV micro-loan against a receipt's DEPOSIT VALUE (frozen price).
// The loan amount is stable — it does not change as the market moves.
// Uses AtomicLockAndLoan to prevent duplicate applications under concurrency.
func (h *Handlers) ApplyForLoanHandler(c *gin.Context) {
	var req LoanApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.ReceiptID = strings.TrimSpace(req.ReceiptID)
	req.FarmerID = strings.TrimSpace(req.FarmerID)

	if req.ReceiptID == "" || req.FarmerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "receipt_id and farmer_id are required"})
		return
	}

	// Fetch receipt to compute principal from deposit value
	receipt, ok := h.store.GetReceipt(req.ReceiptID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "receipt not found"})
		return
	}

	// Loan is 60% of the value at entry time (PriceAtDeposit × Bags).
	// This is intentionally NOT the current market price.
	principal := receipt.DepositValueKES * 0.60

	// AtomicLockAndLoan performs the ownership check, status check, duplicate-loan
	// check, state transition, and loan creation under a single mutex — race-safe.
	loan, err := h.store.AtomicLockAndLoan(req.ReceiptID, req.FarmerID, principal)
	if err != nil {
		status := http.StatusConflict
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		} else if strings.Contains(err.Error(), "does not belong") {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogInfo,
		Message: fmt.Sprintf(
			"💰 LOAN ISSUED | Farmer: %s | Receipt: %s | Deposit value: KES %.2f | Principal (60%% LTV): KES %.2f",
			strings.ToUpper(req.FarmerID), req.ReceiptID[:8], receipt.DepositValueKES, principal,
		),
	})
	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogPayout,
		Message: fmt.Sprintf(
			"💸 M-PESA B2C | Farmer: %s | KES %.2f | Basis: entry price KES %.2f/bag | Status: INSTANT_CREDIT_APPLIED",
			strings.ToUpper(req.FarmerID), principal, receipt.PriceAtDeposit,
		),
	})

	c.JSON(http.StatusCreated, LoanApplicationResponse{
		Loan:            *loan,
		DisbursedKES:    principal,
		DepositValueKES: receipt.DepositValueKES,
		LTVPercent:      60,
	})
}

// ---- Market Status Handler ---------------------------------------------------

// GetMarketStatusHandler handles GET /api/v1/market/status
func (h *Handlers) GetMarketStatusHandler(c *gin.Context) {
	price := h.store.GetMarketPrice()
	c.JSON(http.StatusOK, price)
}

// ---- SSE Log Stream Handler --------------------------------------------------

// StreamLogsHandler handles GET /api/v1/logs/stream
// FIX: Registers the listener FIRST, THEN replays history.
// This ensures no entries are lost between registration and replay.
// Entries emitted during replay are buffered in the per-client channel (cap=64)
// and delivered immediately after history finishes — preserving order.
func (h *Handlers) StreamLogsHandler(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	// Register listener BEFORE fetching history (fixes replay race condition)
	clientChan := make(chan AgentLogEntry, 64)
	h.store.AddLogListener(clientChan)
	defer func() {
		h.store.RemoveLogListener(clientChan)
		close(clientChan)
	}()

	// Replay historical logs — any new entries during replay are queued in clientChan
	historical := h.store.GetLogs()
	for _, entry := range historical {
		data, _ := json.Marshal(entry)
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
	}
	c.Writer.Flush()

	// Stream live entries
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
			if _, err = fmt.Fprintf(c.Writer, "data: %s\n\n", data); err != nil {
				return
			}
			if flusher, ok := c.Writer.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
}

// ---- USSD Handler -----------------------------------------------------------

// USSDHandler handles POST /api/v1/ussd
// Implements a simple text-based USSD state machine for feature phone farmers.
// The `text` field accumulates input across the session, separated by `*`.
// e.g. "" → main menu, "1" → receipt flow, "1*F001" → F001's receipts
func (h *Handlers) USSDHandler(c *gin.Context) {
	var req USSDRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp := h.processUSSD(req)
	c.JSON(http.StatusOK, resp)
}

// processUSSD implements the menu state machine.
func (h *Handlers) processUSSD(req USSDRequest) USSDResponse {
	parts := strings.Split(req.Text, "*")
	// Filter empty parts from splitting "" or trailing "*"
	var levels []string
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			levels = append(levels, strings.TrimSpace(p))
		}
	}

	depth := len(levels)

	// ---- Level 0: Main menu ------------------------------------------------
	if depth == 0 {
		return USSDResponse{
			Type:    "CON",
			Message: "CON MazaoPlus Kilimo\n\n1. My Receipts\n2. Get Cash Advance\n3. Market Price\n4. Loan Balance\n\n0. Exit",
		}
	}

	// ---- Level 1: Route by main menu selection -----------------------------
	switch levels[0] {

	// ---- Branch 1: My Receipts ---------------------------------------------
	case "1":
		if depth == 1 {
			return USSDResponse{Type: "CON", Message: "CON My Receipts\n\nEnter Farmer ID:\n(e.g. F001)"}
		}
		farmerID := strings.ToUpper(levels[1])
		receipts := h.store.GetReceiptsByFarmer(farmerID)
		if len(receipts) == 0 {
			return USSDResponse{
				Type:    "END",
				Message: fmt.Sprintf("END No receipts found\nfor farmer %s.\n\nVisit your cooperative\nwarehouse to deposit.", farmerID),
			}
		}
		msg := fmt.Sprintf("CON Receipts for %s:\n\n", farmerID)
		for i, r := range receipts {
			statusIcon := map[ReceiptStatus]string{
				StatusAvailable:        "✓",
				StatusLockedCollateral: "🔒",
				StatusSettled:          "✅",
			}[r.Status]
			msg += fmt.Sprintf("%d. %s | %d bags %s\n   %s KES %.0f/bag\n",
				i+1, statusIcon, r.QuantityBags, r.CommodityType, r.Status, r.PriceAtDeposit)
		}
		msg += "\n0. Back"
		return USSDResponse{Type: "CON", Message: msg}

	// ---- Branch 2: Get Cash Advance ----------------------------------------
	case "2":
		if depth == 1 {
			return USSDResponse{Type: "CON", Message: "CON Cash Advance\n\nEnter your Farmer ID:\n(e.g. F001)"}
		}
		farmerID := strings.ToUpper(levels[1])
		if depth == 2 {
			receipts := h.store.GetReceiptsByFarmer(farmerID)
			if len(receipts) == 0 {
				return USSDResponse{
					Type:    "END",
					Message: fmt.Sprintf("END No receipts found\nfor %s.\n\nDeposit grain at your\ncooperative first.", farmerID),
				}
			}
			// Find first AVAILABLE receipt
			var available *ProduceReceipt
			for _, r := range receipts {
				if r.Status == StatusAvailable {
					available = r
					break
				}
			}
			if available == nil {
				return USSDResponse{
					Type:    "END",
					Message: "END No available receipts.\n\nAll your grain is\nalready used as\ncollateral.",
				}
			}
			loanAmt := available.DepositValueKES * 0.60
			return USSDResponse{
				Type: "CON",
				Message: fmt.Sprintf(
					"CON Cash Advance\n\n%d bags %s\nEntry: KES %.0f/bag\nDeposit value: KES %.0f\n\nYou can receive:\nKES %.0f (60%% LTV)\n\n1. Confirm & Apply\n0. Cancel",
					available.QuantityBags, available.CommodityType,
					available.PriceAtDeposit, available.DepositValueKES, loanAmt,
				),
			}
		}
		if depth == 3 {
			if levels[2] != "1" {
				return USSDResponse{Type: "END", Message: "END Loan cancelled.\n\nThank you for using\nMazaoPlus."}
			}
			// Execute the loan application
			farmerID = strings.ToUpper(levels[1])
			receipts := h.store.GetReceiptsByFarmer(farmerID)
			var available *ProduceReceipt
			for _, r := range receipts {
				if r.Status == StatusAvailable {
					available = r
					break
				}
			}
			if available == nil {
				return USSDResponse{Type: "END", Message: "END Receipt no longer\navailable. Try again."}
			}
			principal := available.DepositValueKES * 0.60
			_, err := h.store.AtomicLockAndLoan(available.ID, farmerID, principal)
			if err != nil {
				return USSDResponse{
					Type:    "END",
					Message: fmt.Sprintf("END Error: %s\n\nPlease try again or\nvisit your cooperative.", err.Error()),
				}
			}
			h.store.AppendLog(AgentLogEntry{
				Timestamp: time.Now(),
				Level:     LogPayout,
				Message:   fmt.Sprintf("📱 USSD LOAN | Farmer: %s | KES %.2f | Receipt: %s | Status: DISBURSED", farmerID, principal, available.ID[:8]),
			})
			return USSDResponse{
				Type: "END",
				Message: fmt.Sprintf(
					"END SUCCESS!\n\nKES %.0f sent to\nyour M-Pesa.\n\nReceipt: %s...\nlocked as collateral.\n\nAgent will auto-sell\nat peak price.",
					principal, available.ID[:6],
				),
			}
		}

	// ---- Branch 3: Market Price --------------------------------------------
	case "3":
		market := h.store.GetMarketPrice()
		diff := market.TargetThreshold - market.CurrentPrice
		var statusLine string
		if diff <= 0 {
			statusLine = "ABOVE THRESHOLD!\nAgent settling now."
		} else {
			statusLine = fmt.Sprintf("KES %.0f below target.", diff)
		}
		return USSDResponse{
			Type: "END",
			Message: fmt.Sprintf(
				"END Maize Market Price\n\nCurrent: KES %.2f/bag\nTarget:  KES %.0f/bag\n\n%s\n\nMazaoPlus monitors\nprices 24/7.",
				market.CurrentPrice, market.TargetThreshold, statusLine,
			),
		}

	// ---- Branch 4: Loan Balance --------------------------------------------
	case "4":
		if depth == 1 {
			return USSDResponse{Type: "CON", Message: "CON Loan Balance\n\nEnter your Farmer ID:\n(e.g. F001)"}
		}
		farmerID := strings.ToUpper(levels[1])
		receipts := h.store.GetReceiptsByFarmer(farmerID)
		var totalOwed float64
		loanCount := 0
		for _, r := range receipts {
			if loan, ok := h.store.GetLoanByReceipt(r.ID); ok {
				daysElapsed := time.Since(loan.CreatedAt).Hours() / 24
				interest := loan.PrincipalAmount * loan.InterestRate * (daysElapsed / 365)
				storageFee := float64(r.QuantityBags) * r.HoldingCostPerBagMonth * (daysElapsed / 30)
				totalOwed += loan.PrincipalAmount + interest + storageFee
				loanCount++
			}
		}
		if loanCount == 0 {
			return USSDResponse{
				Type:    "END",
				Message: fmt.Sprintf("END No active loans\nfor farmer %s.\n\nYour receipts are\navailable for borrowing.", farmerID),
			}
		}
		return USSDResponse{
			Type: "END",
			Message: fmt.Sprintf(
				"END Loan Summary\nFarmer: %s\n\nActive loans: %d\nTotal owed:\nKES %.2f\n\n(incl. interest &\nstorage fees)",
				farmerID, loanCount, totalOwed,
			),
		}

	// ---- Exit --------------------------------------------------------------
	case "0":
		return USSDResponse{Type: "END", Message: "END Thank you for using\nMazaoPlus Kilimo.\n\nEmpowering farmers\nwith fair prices."}
	}

	// Fallback — unknown input
	return USSDResponse{
		Type:    "CON",
		Message: "CON Invalid option.\n\nPress * to go back\nor 0 to exit.",
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
