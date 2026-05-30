// Package main — models.go
// All data structures for MazaoPlus Phase 3.
// Status machine: AVAILABLE → LOCKED_COLLATERAL → SETTLED
package main

import "time"

// ---- Receipt State Machine ---------------------------------------------------

type ReceiptStatus string

const (
	StatusAvailable        ReceiptStatus = "AVAILABLE"
	StatusLockedCollateral ReceiptStatus = "LOCKED_COLLATERAL"
	StatusSettled          ReceiptStatus = "SETTLED"
)

// ProduceReceipt is the core financial asset.
type ProduceReceipt struct {
	ID                     string        `json:"id"`
	FarmerID               string        `json:"farmer_id"`           // National ID
	CommodityType          string        `json:"commodity_type"`
	QuantityBags           int           `json:"quantity_bags"`
	GradeInfo              string        `json:"grade_info"`
	HoldingCostPerBagMonth float64       `json:"holding_cost_per_bag_month"`
	PriceAtDeposit         float64       `json:"price_at_deposit"`
	DepositValueKES        float64       `json:"deposit_value_kes"`
	TargetSellPrice        *float64      `json:"target_sell_price"` // Phase 4 smart contract target
	Status                 ReceiptStatus `json:"status"`
	CreatedAt              time.Time     `json:"created_at"`
	SettledAt              *time.Time    `json:"settled_at,omitempty"`
}

// ---- Loan -------------------------------------------------------------------

type LoanType string

const (
	LoanTypeReceiptBacked LoanType = "RECEIPT_BACKED"
	LoanTypePreHarvest    LoanType = "PRE_HARVEST"
	LoanTypeInputLoan     LoanType = "INPUT_LOAN"
)

type Loan struct {
	ID              string    `json:"id"`
	ReceiptID       string    `json:"receipt_id,omitempty"`
	FarmerID        string    `json:"farmer_id"`
	LoanType        LoanType  `json:"loan_type"`
	PrincipalAmount float64   `json:"principal_amount"`
	InterestRate    float64   `json:"interest_rate"`
	IsSettled       bool      `json:"is_settled"`
	CreatedAt       time.Time `json:"created_at"`
	SettledAt       *time.Time `json:"settled_at,omitempty"`
}

// ---- Farmer Profile ---------------------------------------------------------

type CreditBand string

const (
	BandBronze   CreditBand = "BRONZE"
	BandSilver   CreditBand = "SILVER"
	BandGold     CreditBand = "GOLD"
	BandPlatinum CreditBand = "PLATINUM"
)

// Farmer is a registered smallholder. NationalID is the primary key.
type Farmer struct {
	NationalID      string     `json:"national_id"`
	FullName        string     `json:"full_name"`
	PhoneNumber     string     `json:"phone_number"`
	WalletBalance   float64    `json:"wallet_balance"`
	CreditScore     int        `json:"credit_score"`     // 0–1000
	CreditBand      CreditBand `json:"credit_band"`
	RegisteredAt    time.Time  `json:"registered_at"`
	LoansSettled    int        `json:"loans_settled"`
	LoansDefaulted  int        `json:"loans_defaulted"`
	TotalDisbursed  float64    `json:"total_disbursed"`  // total profit received
}

// WalletTx is a single wallet debit or credit event.
type WalletTx struct {
	ID          string    `json:"id"`
	FarmerID    string    `json:"farmer_id"`
	Type        string    `json:"type"`        // CREDIT | DEBIT
	Amount      float64   `json:"amount"`
	Description string    `json:"description"`
	Timestamp   time.Time `json:"timestamp"`
}

// ---- Market -----------------------------------------------------------------

// CommodityMarket holds live price data for one commodity.
type CommodityMarket struct {
	Commodity       string    `json:"commodity"`
	CurrentPrice    float64   `json:"current_price"`
	PriceMin        float64   `json:"price_min"`
	PriceMax        float64   `json:"price_max"`
	TargetThreshold float64   `json:"target_threshold"`
	PriceHistory    []float64 `json:"price_history"` // last 30 ticks
	PhaseDeg        float64   `json:"phase_deg"`     // internal sine phase
	Volatility      float64   `json:"volatility"`    // noise factor 0.01-0.08
	Timestamp       time.Time `json:"timestamp"`
}

// MarketPrice is the legacy alias for the chart polling endpoint (Maize only).
// Kept for backwards-compat with LiveMonitor.
type MarketPrice = CommodityMarket

// ---- Logging ----------------------------------------------------------------

type LogLevel string

const (
	LogInfo         LogLevel = "INFO"
	LogWarn         LogLevel = "WARN"
	LogTrigger      LogLevel = "TRIGGER"
	LogPayout       LogLevel = "PAYOUT"
	LogArbitration  LogLevel = "ARBITRATION"
	LogError        LogLevel = "ERROR"
)

type AgentLogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     LogLevel  `json:"level"`
	Message   string    `json:"message"`
}

// ---- Settlement Ledger ------------------------------------------------------

// SettlementResult holds a full accounting breakdown.
type SettlementResult struct {
	ReceiptID    string  `json:"receipt_id"`
	FarmerID     string  `json:"farmer_id"`
	SalePrice    float64 `json:"sale_price"`    // KES per bag at time of sale
	GrossRevenue float64 `json:"gross_revenue"` // Bags × SalePrice
	Principal    float64 `json:"principal"`
	Interest     float64 `json:"interest"`
	StorageFee   float64 `json:"storage_fee"`
	PlatformFee  float64 `json:"platform_fee"`  // 1% of gross
	TotalDebt    float64 `json:"total_debt"`
	NetProfit    float64 `json:"net_profit"`
	DaysElapsed  float64 `json:"days_elapsed"`
}

// ---- Request / Response DTOs ------------------------------------------------

type ReceiptCreateRequest struct {
	FarmerID      string `json:"farmer_id"      binding:"required"`
	CommodityType string `json:"commodity_type" binding:"required"`
	QuantityBags  int    `json:"quantity_bags"  binding:"required,min=1"`
	GradeInfo     string `json:"grade_info"`
}

type LoanApplicationRequest struct {
	ReceiptID       string   `json:"receipt_id" binding:"required"`
	FarmerID        string   `json:"farmer_id"  binding:"required"`
	RequestedAmount *float64 `json:"requested_amount"` // Optional: up to 60% max
}

type LoanApplicationResponse struct {
	Loan            Loan    `json:"loan"`
	DisbursedKES    float64 `json:"disbursed_kes"`
	DepositValueKES float64 `json:"deposit_value_kes"`
	LTVPercent      float64 `json:"ltv_percent"`
}

// ---- Admin Metrics -----------------------------------------------------------

type CommodityMetrics struct {
	TotalBags     int     `json:"total_bags"`
	TotalValueKES float64 `json:"total_value_kes"`
}

type AdminMetrics struct {
	TotalFarmers            int                         `json:"total_farmers"`
	TotalActiveLoans        int                         `json:"total_active_loans"`
	TotalLoanValueKES       float64                     `json:"total_loan_value_kes"`
	TotalCollateralValueKES float64                     `json:"total_collateral_value_kes"`
	TotalDisbursed          float64                     `json:"total_disbursed"`
	Commodities             map[string]CommodityMetrics `json:"commodities"`
}

// FarmerLoginRequest — enter National ID to authenticate.
type FarmerLoginRequest struct {
	NationalID  string `json:"national_id"  binding:"required"`
	FullName    string `json:"full_name"`
	PhoneNumber string `json:"phone_number"`
}

// ManualSellRequest — farmer-initiated settlement at current market price.
type ManualSellRequest struct {
	FarmerID string `json:"farmer_id" binding:"required"`
}

// TargetPriceRequest — set per-receipt smart sell target.
type TargetPriceRequest struct {
	FarmerID    string   `json:"farmer_id" binding:"required"`
	TargetPrice *float64 `json:"target_price"`
}

// InputLoanRequest — apply for a credit-score-gated non-receipt loan.
type InputLoanRequest struct {
	FarmerID    string   `json:"farmer_id"    binding:"required"`
	LoanType    LoanType `json:"loan_type"    binding:"required"`
	AmountKES   float64  `json:"amount_kes"   binding:"required,min=1000"`
	Description string   `json:"description"`
}

// InputLoanResponse is the response for input/pre-harvest loan applications.
type InputLoanResponse struct {
	Loan          Loan    `json:"loan"`
	DisbursedKES  float64 `json:"disbursed_kes"`
	CreditScore   int     `json:"credit_score"`
	CreditBand    CreditBand `json:"credit_band"`
	MaxAllowedKES float64 `json:"max_allowed_kes"`
}

// ---- USSD -------------------------------------------------------------------

type USSDRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	FarmerID  string `json:"farmer_id"`
	Text      string `json:"text"`
}

type USSDResponse struct {
	Type    string `json:"type"`    // CON | END
	Message string `json:"message"`
}
