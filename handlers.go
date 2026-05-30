// Package main — handlers.go
// Thin Gin HTTP handlers for Phase 3.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type Handlers struct {
	store *Store
}

func NewHandlers(store *Store) *Handlers {
	return &Handlers{store: store}
}

// ---- Farmer Profile & Wallet Handlers ----------------------------------------

func (h *Handlers) FarmerLoginHandler(c *gin.Context) {
	var req FarmerLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	farmer := h.store.RegisterOrGetFarmer(req)
	c.JSON(http.StatusOK, farmer)
}

func (h *Handlers) GetFarmerProfileHandler(c *gin.Context) {
	id := c.Param("id")
	farmer, ok := h.store.GetFarmer(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "farmer not found"})
		return
	}
	c.JSON(http.StatusOK, farmer)
}

func (h *Handlers) GetFarmerWalletHandler(c *gin.Context) {
	id := c.Param("id")
	farmer, ok := h.store.GetFarmer(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "farmer not found"})
		return
	}
	history := h.store.GetWalletHistory(id)
	c.JSON(http.StatusOK, gin.H{
		"balance":      farmer.WalletBalance,
		"transactions": history,
	})
}

// ---- Receipt Handlers --------------------------------------------------------

func (h *Handlers) CreateReceiptHandler(c *gin.Context) {
	var req ReceiptCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.GradeInfo == "" {
		req.GradeInfo = "Grade 1"
	}

	mkt, ok := h.store.GetCommodityPrice(req.CommodityType)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported commodity type"})
		return
	}

	receipt := h.store.CreateReceipt(req, mkt.CurrentPrice)

	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(), Level: LogInfo,
		Message: fmt.Sprintf("🌽 Receipt minted | ID: %s | Farmer: %s | %d bags %s | Entry: KES %.2f/bag",
			receipt.ID[:8], receipt.FarmerID, receipt.QuantityBags, receipt.CommodityType, receipt.PriceAtDeposit),
	})
	c.JSON(http.StatusCreated, receipt)
}

func (h *Handlers) GetFarmerReceiptsHandler(c *gin.Context) {
	rawID := c.Param("id")
	farmerID := strings.ToUpper(strings.TrimSpace(rawID))
	if farmerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "farmer id is required"})
		return
	}

	receipts := h.store.GetReceiptsByFarmer(farmerID)

	type EnrichedReceipt struct {
		*ProduceReceipt
		CurrentMarketValueKES float64 `json:"current_market_value_kes"`
		MaxLoanKES            float64 `json:"max_loan_kes"`
		CurrentPriceKES       float64 `json:"current_price_kes"`
		ActiveLoan            *Loan   `json:"active_loan,omitempty"`
	}

	enriched := make([]EnrichedReceipt, 0, len(receipts))
	for _, r := range receipts {
		mkt, _ := h.store.GetCommodityPrice(r.CommodityType)
		liveVal := float64(r.QuantityBags) * mkt.CurrentPrice
		loan, _ := h.store.GetLoanByReceipt(r.ID)
		enriched = append(enriched, EnrichedReceipt{
			ProduceReceipt:        r,
			CurrentMarketValueKES: liveVal,
			MaxLoanKES:            r.DepositValueKES * 0.60,
			CurrentPriceKES:       mkt.CurrentPrice,
			ActiveLoan:            loan,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"farmer_id": farmerID,
		"receipts":  enriched,
		"count":     len(enriched),
	})
}

// ManualSellHandler handles POST /api/v1/receipts/:id/sell
// Farmer initiates manual settlement at current market price.
func (h *Handlers) ManualSellHandler(c *gin.Context) {
	var req ManualSellRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	receiptID := c.Param("id")
	receipt, ok := h.store.GetReceipt(receiptID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "receipt not found"})
		return
	}

	if receipt.FarmerID != normalizeFarmerID(req.FarmerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "receipt does not belong to farmer"})
		return
	}

	if receipt.Status == StatusSettled {
		c.JSON(http.StatusConflict, gin.H{"error": "cannot sell an already SETTLED receipt"})
		return
	}

	mkt, ok := h.store.GetCommodityPrice(receipt.CommodityType)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "market data unavailable"})
		return
	}

	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(), Level: LogInfo,
		Message: fmt.Sprintf("👨‍🌾 Farmer-initiated manual sell | Receipt: %s | Farmer: %s | Price: KES %.2f",
			receipt.ID[:8], receipt.FarmerID, mkt.CurrentPrice),
	})

	result := calculateSettlement(h.store, receipt, mkt.CurrentPrice)
	logSettlementBreakdown(h.store, result)

	if err := h.store.SettleReceiptWithTimestamp(receipt.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if loan, ok := h.store.GetLoanByReceipt(receipt.ID); ok {
		h.store.SettleLoanWithTimestamp(loan.ID)
	}

	h.store.CreditFarmerWallet(receipt.FarmerID,
		fmt.Sprintf("Manual sell — %s — %d bags × KES %.2f", receipt.CommodityType, receipt.QuantityBags, mkt.CurrentPrice),
		result.NetProfit)
	h.store.IncrementLoansSettled(receipt.FarmerID)
	h.store.RecalculateCreditScore(receipt.FarmerID)

	c.JSON(http.StatusOK, result)
}

// SetTargetPriceHandler handles PATCH /api/v1/receipts/:id/target-price
func (h *Handlers) SetTargetPriceHandler(c *gin.Context) {
	var req TargetPriceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	receiptID := c.Param("id")
	if err := h.store.SetTargetPrice(receiptID, req.FarmerID, req.TargetPrice); err != nil {
		status := http.StatusConflict
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		} else if strings.Contains(err.Error(), "belong") {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	targetStr := "CLEARED 🛑"
	if req.TargetPrice != nil {
		targetStr = fmt.Sprintf("SET to KES %.0f 🎯", *req.TargetPrice)
	}
	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(), Level: LogInfo,
		Message: fmt.Sprintf("⚙️ Smart Sell Target %s for Receipt %s by Farmer %s", targetStr, receiptID[:8], req.FarmerID),
	})

	c.JSON(http.StatusOK, gin.H{"status": "success", "target_price": req.TargetPrice})
}

// ---- Loan Handlers -----------------------------------------------------------

func (h *Handlers) ApplyForLoanHandler(c *gin.Context) {
	var req LoanApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	receipt, ok := h.store.GetReceipt(req.ReceiptID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "receipt not found"})
		return
	}

	maxLoan := receipt.DepositValueKES * 0.60
	principal := maxLoan
	if req.RequestedAmount != nil {
		if *req.RequestedAmount <= 0 || *req.RequestedAmount > maxLoan {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("requested amount must be between 1 and %.2f", maxLoan)})
			return
		}
		principal = *req.RequestedAmount
	}

	loan, err := h.store.AtomicLockAndLoan(req.ReceiptID, req.FarmerID, principal)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(), Level: LogInfo,
		Message: fmt.Sprintf("💰 RECEIPT LOAN ISSUED | Farmer: %s | Principal: KES %.2f",
			normalizeFarmerID(req.FarmerID), principal),
	})

	// Simulate M-Pesa Disbursement to Wallet
	h.store.CreditFarmerWallet(
		req.FarmerID,
		fmt.Sprintf("M-Pesa Disbursement: Receipt Backed Loan (#%s)", req.ReceiptID[:8]),
		principal,
	)

	c.JSON(http.StatusCreated, LoanApplicationResponse{
		Loan:            *loan,
		DisbursedKES:    principal,
		DepositValueKES: receipt.DepositValueKES,
		LTVPercent:      60,
	})
}

// InputLoanHandler handles POST /api/v1/loans/input-loan
// Issues credit-score-gated unsecured loans.
func (h *Handlers) InputLoanHandler(c *gin.Context) {
	var req InputLoanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	farmer, ok := h.store.GetFarmer(req.FarmerID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "farmer not found"})
		return
	}

	_, maxAllowed := creditBandFromScore(farmer.CreditScore)
	if req.AmountKES > maxAllowed {
		c.JSON(http.StatusForbidden, gin.H{
			"error":           fmt.Sprintf("requested amount exceeds credit limit for band %s", farmer.CreditBand),
			"max_allowed_kes": maxAllowed,
		})
		return
	}
	if req.AmountKES <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid loan amount"})
		return
	}

	loan := h.store.CreateInputLoan(req.FarmerID, req.LoanType, req.AmountKES)

	h.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(), Level: LogInfo,
		Message: fmt.Sprintf("🌱 UNSECURED %s ISSUED | Farmer: %s | Amount: KES %.2f | Band: %s",
			req.LoanType, farmer.NationalID, req.AmountKES, farmer.CreditBand),
	})

	// Simulate M-Pesa Disbursement to Wallet
	h.store.CreditFarmerWallet(
		req.FarmerID,
		fmt.Sprintf("M-Pesa Disbursement: %s", req.LoanType),
		req.AmountKES,
	)

	c.JSON(http.StatusCreated, InputLoanResponse{
		Loan:          *loan,
		DisbursedKES:  req.AmountKES,
		CreditScore:   farmer.CreditScore,
		CreditBand:    farmer.CreditBand,
		MaxAllowedKES: maxAllowed,
	})
}

// ---- Market Status Handlers --------------------------------------------------

func (h *Handlers) GetMarketStatusHandler(c *gin.Context) {
	c.JSON(http.StatusOK, h.store.GetMarketPrice()) // legacy, returns Maize
}

func (h *Handlers) GetAllMarketPricesHandler(c *gin.Context) {
	prices := h.store.GetAllMarketPrices()
	c.JSON(http.StatusOK, prices)
}

// ---- SSE Log Stream Handler --------------------------------------------------

func (h *Handlers) StreamLogsHandler(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	clientChan := make(chan AgentLogEntry, 64)
	h.store.AddLogListener(clientChan)
	defer func() {
		h.store.RemoveLogListener(clientChan)
		close(clientChan)
	}()

	historical := h.store.GetLogs()
	for _, entry := range historical {
		data, _ := json.Marshal(entry)
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
	}
	c.Writer.Flush()

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

func (h *Handlers) USSDHandler(c *gin.Context) {
	var req USSDRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	resp := h.processUSSD(req)
	c.JSON(http.StatusOK, resp)
}

func (h *Handlers) processUSSD(req USSDRequest) USSDResponse {
	parts := strings.Split(req.Text, "*")
	var levels []string
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			levels = append(levels, strings.TrimSpace(p))
		}
	}
	depth := len(levels)

	if depth == 0 {
		return USSDResponse{
			Type:    "CON",
			Message: "CON MazaoPlus Kilimo\n\n1. My Receipts\n2. Get Cash Advance\n3. Market Price\n4. Loan Balance\n5. Smart Sell Target\n6. Credit Score\n\n0. Exit",
		}
	}

	switch levels[0] {
	case "1": // Receipts
		if depth == 1 {
			return USSDResponse{Type: "CON", Message: "CON My Receipts\n\nEnter National ID:"}
		}
		farmerID := levels[1]
		receipts := h.store.GetReceiptsByFarmer(farmerID)
		if len(receipts) == 0 {
			return USSDResponse{Type: "END", Message: "END No receipts found."}
		}
		msg := "CON Receipts:\n\n"
		for i, r := range receipts {
			status := map[ReceiptStatus]string{StatusAvailable: "✓", StatusLockedCollateral: "🔒", StatusSettled: "✅"}[r.Status]
			msg += fmt.Sprintf("%d. %s %d bags %s\n", i+1, status, r.QuantityBags, r.CommodityType)
		}
		return USSDResponse{Type: "CON", Message: msg + "\n0. Back"}

	case "2": // Cash Advance
		if depth == 1 {
			return USSDResponse{Type: "CON", Message: "CON Cash Advance\n\nEnter National ID:"}
		}
		farmerID := levels[1]
		receipts := h.store.GetReceiptsByFarmer(farmerID)
		var available *ProduceReceipt
		for _, r := range receipts {
			if r.Status == StatusAvailable {
				available = r
				break
			}
		}
		if available == nil {
			return USSDResponse{Type: "END", Message: "END No available receipts."}
		}
		maxLoan := available.DepositValueKES * 0.60
		
		if depth == 2 {
			return USSDResponse{Type: "CON", Message: fmt.Sprintf("CON Enter loan amount (Max KES %.0f):", maxLoan)}
		}
		
		requestedStr := levels[2]
		requested, _ := strconv.ParseFloat(requestedStr, 64)
		if requested <= 0 || requested > maxLoan {
			return USSDResponse{Type: "END", Message: "END Invalid loan amount."}
		}

		if depth == 3 {
			return USSDResponse{Type: "CON", Message: fmt.Sprintf("CON Advance\n\nReceive KES %.0f\n\n1. Confirm\n0. Cancel", requested)}
		}
		if depth == 4 {
			if levels[3] != "1" {
				return USSDResponse{Type: "END", Message: "END Cancelled."}
			}
			_, err := h.store.AtomicLockAndLoan(available.ID, farmerID, requested)
			if err != nil {
				return USSDResponse{Type: "END", Message: "END Error: " + err.Error()}
			}
			
			h.store.CreditFarmerWallet(
				farmerID,
				fmt.Sprintf("M-Pesa Disbursement: USSD Loan (#%s)", available.ID[:8]),
				requested,
			)
			
			return USSDResponse{Type: "END", Message: "END SUCCESS! Disbursed to M-Pesa."}
		}

	case "3": // Market Price
		prices := h.store.GetAllMarketPrices()
		msg := "END Market Prices\n\n"
		for _, m := range prices {
			if m.Commodity == "Maize" || m.Commodity == "Wheat" {
				msg += fmt.Sprintf("%s: KES %.0f\n(Target: %.0f)\n", m.Commodity, m.CurrentPrice, m.TargetThreshold)
			}
		}
		return USSDResponse{Type: "END", Message: msg}

	case "4": // Loan Balance
		if depth == 1 {
			return USSDResponse{Type: "CON", Message: "CON Loan Balance\n\nEnter National ID:"}
		}
		farmerID := levels[1]
		loans := h.store.GetActiveLoansByFarmer(farmerID)
		if len(loans) == 0 {
			return USSDResponse{Type: "END", Message: "END No active loans."}
		}
		total := 0.0
		for _, l := range loans {
			total += l.PrincipalAmount
		}
		return USSDResponse{Type: "END", Message: fmt.Sprintf("END Total Owed:\nKES %.2f", total)}

	case "5": // Smart Sell Settings
		if depth == 1 {
			return USSDResponse{Type: "CON", Message: "CON Smart Sell Target\n\nEnter National ID:"}
		}
		farmerID := levels[1]
		if depth == 2 {
			receipts := h.store.GetReceiptsByFarmer(farmerID)
			var locked *ProduceReceipt
			for _, r := range receipts {
				if r.Status == StatusLockedCollateral {
					locked = r
					break
				}
			}
			if locked == nil {
				return USSDResponse{Type: "END", Message: "END No locked receipts."}
			}
			statusStr := "NOT SET"
			if locked.TargetSellPrice != nil {
				statusStr = fmt.Sprintf("KES %.0f", *locked.TargetSellPrice)
			}
			return USSDResponse{Type: "CON", Message: fmt.Sprintf("CON Target: %s\nReceipt: %s\n\nEnter new target price per bag (e.g. 3500) or 0 to clear:", statusStr, locked.ID[:6])}
		}
		if depth == 3 {
			receipts := h.store.GetReceiptsByFarmer(farmerID)
			for _, r := range receipts {
				if r.Status == StatusLockedCollateral {
					val, _ := strconv.ParseFloat(levels[2], 64)
					var target *float64
					if val > 0 {
						target = &val
					}
					h.store.SetTargetPrice(r.ID, farmerID, target)
					return USSDResponse{Type: "END", Message: "END Target price updated."}
				}
			}
			return USSDResponse{Type: "END", Message: "END Receipt not found."}
		}

	case "6": // Credit Score
		if depth == 1 {
			return USSDResponse{Type: "CON", Message: "CON Credit Score\n\nEnter National ID:"}
		}
		farmerID := levels[1]
		farmer, ok := h.store.GetFarmer(farmerID)
		if !ok {
			return USSDResponse{Type: "END", Message: "END Farmer not found."}
		}
		return USSDResponse{Type: "END", Message: fmt.Sprintf("END Score: %d\nBand: %s\nSettled: %d", farmer.CreditScore, farmer.CreditBand, farmer.LoansSettled)}

	case "0":
		return USSDResponse{Type: "END", Message: "END Goodbye."}
	}

	return USSDResponse{Type: "CON", Message: "CON Invalid option.\n0. Back"}
}

// ---- Health -----------------------------------------------------------------

func (h *Handlers) HealthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "MazaoPlus"})
}

// ---- Admin ------------------------------------------------------------------

// GetAdminMetricsHandler handles GET /api/v1/admin/metrics
func (h *Handlers) GetAdminMetricsHandler(c *gin.Context) {
	metrics := h.store.GetAdminMetrics()
	c.JSON(http.StatusOK, metrics)
}
