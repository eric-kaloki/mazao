// Package main — models.go
// Pure data structures for MazaoPlus. No ORM, no DB tags.
// Status transitions: AVAILABLE → LOCKED_COLLATERAL → SETTLED
package main

import "time"

// ReceiptStatus represents the strict state machine for a produce receipt.
type ReceiptStatus string

const (
	StatusAvailable        ReceiptStatus = "AVAILABLE"
	StatusLockedCollateral ReceiptStatus = "LOCKED_COLLATERAL"
	StatusSettled          ReceiptStatus = "SETTLED"
)

// ProduceReceipt is the core financial asset — a tokenised warehouse deposit.
type ProduceReceipt struct {
	ID                     string        `json:"id"`
	FarmerID               string        `json:"farmer_id"`
	CommodityType          string        `json:"commodity_type"`
	QuantityBags           int           `json:"quantity_bags"`
	GradeInfo              string        `json:"grade_info"`
	HoldingCostPerBagMonth float64       `json:"holding_cost_per_bag_month"` // KES 10 default
	Status                 ReceiptStatus `json:"status"`
	CreatedAt              time.Time     `json:"created_at"`
}

// Loan is an asset-backed credit advance issued against a locked receipt.
type Loan struct {
	ID              string    `json:"id"`
	ReceiptID       string    `json:"receipt_id"`
	FarmerID        string    `json:"farmer_id"`
	PrincipalAmount float64   `json:"principal_amount"` // 60% LTV of market value at issuance
	InterestRate    float64   `json:"interest_rate"`    // fixed 8% annual
	IsSettled       bool      `json:"is_settled"`
	CreatedAt       time.Time `json:"created_at"`
}

// MarketPrice holds the live simulated market price for a commodity.
type MarketPrice struct {
	Commodity       string    `json:"commodity"`
	CurrentPrice    float64   `json:"current_price"`    // KES per bag
	TargetThreshold float64   `json:"target_threshold"` // KES 3500 — agent triggers above this
	PriceHistory    []float64 `json:"price_history"`    // last 30 ticks for charting
	Timestamp       time.Time `json:"timestamp"`
}

// LogLevel classifies an agent log entry for frontend colour-coding.
type LogLevel string

const (
	LogInfo    LogLevel = "INFO"
	LogWarn    LogLevel = "WARN"
	LogTrigger LogLevel = "TRIGGER"
	LogPayout  LogLevel = "PAYOUT"
	LogError   LogLevel = "ERROR"
)

// AgentLogEntry is a single line emitted by the autonomous background agent.
type AgentLogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     LogLevel  `json:"level"`
	Message   string    `json:"message"`
}

// ---- Request / Response DTOs ------------------------------------------------

// ReceiptCreateRequest is the payload from the Warehouse Portal form.
type ReceiptCreateRequest struct {
	FarmerID      string `json:"farmer_id"      binding:"required"`
	CommodityType string `json:"commodity_type" binding:"required"`
	QuantityBags  int    `json:"quantity_bags"  binding:"required,min=1"`
	GradeInfo     string `json:"grade_info"`
}

// LoanApplicationRequest triggers a 60% LTV advance against a specific receipt.
type LoanApplicationRequest struct {
	ReceiptID string `json:"receipt_id" binding:"required"`
	FarmerID  string `json:"farmer_id"  binding:"required"`
}

// LoanApplicationResponse is returned after a successful loan issuance.
type LoanApplicationResponse struct {
	Loan          Loan    `json:"loan"`
	DisbursedKES  float64 `json:"disbursed_kes"`
	MarketValueAt float64 `json:"market_value_at_application"`
	LTVPercent    int     `json:"ltv_percent"`
}

// SettlementResult holds per-receipt settlement calculation details.
type SettlementResult struct {
	ReceiptID    string  `json:"receipt_id"`
	FarmerID     string  `json:"farmer_id"`
	GrossRevenue float64 `json:"gross_revenue"`
	TotalDebt    float64 `json:"total_debt"`
	NetProfit    float64 `json:"net_profit"`
}
