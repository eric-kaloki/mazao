// Package main — store.go
// Thread-safe in-memory repository for MazaoPlus Phase 3.
package main

import (
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ---- Commodity definitions --------------------------------------------------

// defaultCommodities defines the 5 tracked grain markets.
var defaultCommodities = []CommodityMarket{
	{Commodity: "Maize",   CurrentPrice: 2800, PriceMin: 2500, PriceMax: 4500, TargetThreshold: 3500, Volatility: 0.035},
	{Commodity: "Wheat",   CurrentPrice: 3800, PriceMin: 3000, PriceMax: 5500, TargetThreshold: 4200, Volatility: 0.025},
	{Commodity: "Sorghum", CurrentPrice: 2000, PriceMin: 1800, PriceMax: 3200, TargetThreshold: 2600, Volatility: 0.055},
	{Commodity: "Millet",  CurrentPrice: 2500, PriceMin: 2200, PriceMax: 3800, TargetThreshold: 3000, Volatility: 0.040},
	{Commodity: "Rice",    CurrentPrice: 5500, PriceMin: 4500, PriceMax: 7500, TargetThreshold: 6000, Volatility: 0.020},
}

// creditBandFromScore maps a score to its band name and max input loan.
func creditBandFromScore(score int) (CreditBand, float64) {
	switch {
	case score >= 800:
		return BandPlatinum, 500000
	case score >= 600:
		return BandGold, 50000
	case score >= 400:
		return BandSilver, 20000
	default:
		return BandBronze, 0
	}
}

// ---- Store ------------------------------------------------------------------

type Store struct {
	mu sync.RWMutex

	farmers    map[string]*Farmer         // keyed by NationalID
	receipts   map[string]*ProduceReceipt // keyed by receipt ID
	loans      map[string]*Loan           // keyed by loan ID
	walletTxs  []WalletTx
	commodities map[string]*CommodityMarket // keyed by commodity name

	logs         []AgentLogEntry
	logListeners []chan AgentLogEntry
	listenerMu   sync.Mutex
}

func NewStore() *Store {
	s := &Store{
		farmers:     make(map[string]*Farmer),
		receipts:    make(map[string]*ProduceReceipt),
		loans:       make(map[string]*Loan),
		commodities: make(map[string]*CommodityMarket),
		logs:        []AgentLogEntry{},
		walletTxs:   []WalletTx{},
	}
	for _, c := range defaultCommodities {
		c := c // capture range var
		c.PriceHistory = []float64{}
		c.Timestamp = time.Now()
		s.commodities[c.Commodity] = &c
	}
	return s
}

func normalizeFarmerID(id string) string {
	return strings.ToUpper(strings.TrimSpace(id))
}

// ---- Farmer Repository -------------------------------------------------------

// RegisterOrGetFarmer upserts a farmer by National ID.
// If first-time, creates a new profile with a Bronze credit score (300).
func (s *Store) RegisterOrGetFarmer(req FarmerLoginRequest) *Farmer {
	id := normalizeFarmerID(req.NationalID)
	s.mu.Lock()
	defer s.mu.Unlock()

	if f, ok := s.farmers[id]; ok {
		// Update name/phone if provided
		if req.FullName != "" {
			f.FullName = req.FullName
		}
		if req.PhoneNumber != "" {
			f.PhoneNumber = req.PhoneNumber
		}
		return f
	}

	name := req.FullName
	if name == "" {
		name = "Farmer " + id
	}
	band, _ := creditBandFromScore(300)
	f := &Farmer{
		NationalID:   id,
		FullName:     name,
		PhoneNumber:  req.PhoneNumber,
		WalletBalance: 0,
		CreditScore:  300,
		CreditBand:   band,
		RegisteredAt: time.Now(),
	}
	s.farmers[id] = f
	return f
}

func (s *Store) GetFarmer(nationalID string) (*Farmer, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	f, ok := s.farmers[normalizeFarmerID(nationalID)]
	return f, ok
}

// CreditFarmerWallet adds amount to farmer's wallet and records a WalletTx.
func (s *Store) CreditFarmerWallet(nationalID, description string, amount float64) {
	id := normalizeFarmerID(nationalID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if f, ok := s.farmers[id]; ok {
		f.WalletBalance += amount
		f.TotalDisbursed += amount
	}
	tx := WalletTx{
		ID:          uuid.NewString(),
		FarmerID:    id,
		Type:        "CREDIT",
		Amount:      amount,
		Description: description,
		Timestamp:   time.Now(),
	}
	s.walletTxs = append(s.walletTxs, tx)
}

// GetWalletHistory returns transaction history for a farmer.
func (s *Store) GetWalletHistory(nationalID string) []WalletTx {
	id := normalizeFarmerID(nationalID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []WalletTx
	for _, tx := range s.walletTxs {
		if tx.FarmerID == id {
			result = append(result, tx)
		}
	}
	return result
}

// RecalculateCreditScore recomputes a farmer's score from their history.
// Call this after every settlement or default event.
func (s *Store) RecalculateCreditScore(nationalID string) {
	id := normalizeFarmerID(nationalID)
	s.mu.Lock()
	defer s.mu.Unlock()

	f, ok := s.farmers[id]
	if !ok {
		return
	}

	total := f.LoansSettled + f.LoansDefaulted
	if total == 0 {
		return // Not enough history yet
	}

	// Repayment ratio (0–350 pts)
	repaymentPct := float64(f.LoansSettled) / float64(total)
	repaymentPts := repaymentPct * 350

	// Tenure bonus (0–100 pts) — 10 pts per month registered
	tenureMonths := time.Since(f.RegisteredAt).Hours() / (24 * 30)
	tenurePts := math.Min(tenureMonths*10, 100)

	// Settlement volume bonus (0–200 pts) — 10 pts per settled loan up to 20
	volumePts := math.Min(float64(f.LoansSettled)*10, 200)

	// Base score
	score := int(repaymentPts + tenurePts + volumePts + 150) // 150 base
	if score > 1000 {
		score = 1000
	}
	f.CreditScore = score
	f.CreditBand, _ = creditBandFromScore(score)
}

// IncrementLoansSettled marks a loan as settled in farmer stats.
func (s *Store) IncrementLoansSettled(nationalID string) {
	id := normalizeFarmerID(nationalID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if f, ok := s.farmers[id]; ok {
		f.LoansSettled++
	}
}

// ---- Receipt Repository ------------------------------------------------------

func (s *Store) CreateReceipt(req ReceiptCreateRequest, priceAtDeposit float64) *ProduceReceipt {
	farmerID := normalizeFarmerID(req.FarmerID)
	receipt := &ProduceReceipt{
		ID:                     uuid.NewString(),
		FarmerID:               farmerID,
		CommodityType:          req.CommodityType,
		QuantityBags:           req.QuantityBags,
		GradeInfo:              req.GradeInfo,
		HoldingCostPerBagMonth: 10.0,
		PriceAtDeposit:         priceAtDeposit,
		DepositValueKES:        float64(req.QuantityBags) * priceAtDeposit,
		AutoSellEnabled:        true, // default on
		Status:                 StatusAvailable,
		CreatedAt:              time.Now(),
	}
	s.mu.Lock()
	s.receipts[receipt.ID] = receipt
	s.mu.Unlock()
	return receipt
}

func (s *Store) GetReceiptsByFarmer(farmerID string) []*ProduceReceipt {
	normalized := normalizeFarmerID(farmerID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*ProduceReceipt
	for _, r := range s.receipts {
		if r.FarmerID == normalized {
			result = append(result, r)
		}
	}
	return result
}

func (s *Store) GetReceipt(id string) (*ProduceReceipt, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.receipts[id]
	return r, ok
}

func (s *Store) GetLockedReceipts() []*ProduceReceipt {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*ProduceReceipt
	for _, r := range s.receipts {
		if r.Status == StatusLockedCollateral {
			result = append(result, r)
		}
	}
	return result
}

// AtomicLockAndLoan performs receipt lock + loan creation under one mutex.
func (s *Store) AtomicLockAndLoan(receiptID, farmerID string, principal float64) (*Loan, error) {
	normalized := normalizeFarmerID(farmerID)
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.receipts[receiptID]
	if !ok {
		return nil, fmt.Errorf("receipt %s not found", receiptID)
	}
	if r.FarmerID != normalized {
		return nil, fmt.Errorf("receipt does not belong to farmer %s", farmerID)
	}
	if r.Status != StatusAvailable {
		return nil, fmt.Errorf("receipt is not AVAILABLE (current status: %s)", r.Status)
	}
	for _, l := range s.loans {
		if l.ReceiptID == receiptID && !l.IsSettled {
			return nil, fmt.Errorf("an active loan already exists for this receipt")
		}
	}
	r.Status = StatusLockedCollateral
	loan := &Loan{
		ID:              uuid.NewString(),
		ReceiptID:       receiptID,
		FarmerID:        normalized,
		LoanType:        LoanTypeReceiptBacked,
		PrincipalAmount: principal,
		InterestRate:    0.08,
		IsSettled:       false,
		CreatedAt:       time.Now(),
	}
	s.loans[loan.ID] = loan
	return loan, nil
}

// SettleReceiptWithTimestamp marks a receipt settled and stamps the time.
func (s *Store) SettleReceiptWithTimestamp(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.receipts[id]
	if !ok {
		return fmt.Errorf("receipt %s not found", id)
	}
	if r.Status != StatusLockedCollateral {
		return fmt.Errorf("receipt %s is not LOCKED_COLLATERAL (current: %s)", id, r.Status)
	}
	now := time.Now()
	r.Status = StatusSettled
	r.SettledAt = &now
	return nil
}

// ToggleAutoSell enables or disables agent auto-settlement for a receipt.
func (s *Store) ToggleAutoSell(receiptID, farmerID string, enabled bool) error {
	normalized := normalizeFarmerID(farmerID)
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.receipts[receiptID]
	if !ok {
		return fmt.Errorf("receipt not found")
	}
	if r.FarmerID != normalized {
		return fmt.Errorf("receipt does not belong to farmer %s", farmerID)
	}
	if r.Status != StatusLockedCollateral {
		return fmt.Errorf("can only toggle auto-sell on LOCKED receipts")
	}
	r.AutoSellEnabled = enabled
	return nil
}

// ---- Loan Repository ---------------------------------------------------------

func (s *Store) CreateLoan(receiptID, farmerID string, principal float64) *Loan {
	loan := &Loan{
		ID:              uuid.NewString(),
		ReceiptID:       receiptID,
		FarmerID:        normalizeFarmerID(farmerID),
		LoanType:        LoanTypeReceiptBacked,
		PrincipalAmount: principal,
		InterestRate:    0.08,
		IsSettled:       false,
		CreatedAt:       time.Now(),
	}
	s.mu.Lock()
	s.loans[loan.ID] = loan
	s.mu.Unlock()
	return loan
}

// CreateInputLoan creates a non-receipt-backed loan (pre-harvest / input).
func (s *Store) CreateInputLoan(farmerID string, loanType LoanType, amount float64) *Loan {
	rate := 0.12 // 12% for unsecured loans
	loan := &Loan{
		ID:              uuid.NewString(),
		FarmerID:        normalizeFarmerID(farmerID),
		LoanType:        loanType,
		PrincipalAmount: amount,
		InterestRate:    rate,
		IsSettled:       false,
		CreatedAt:       time.Now(),
	}
	s.mu.Lock()
	s.loans[loan.ID] = loan
	s.mu.Unlock()
	return loan
}

func (s *Store) GetLoanByReceipt(receiptID string) (*Loan, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, l := range s.loans {
		if l.ReceiptID == receiptID && !l.IsSettled {
			return l, true
		}
	}
	return nil, false
}

// SettleLoanWithTimestamp marks a loan settled with a timestamp.
func (s *Store) SettleLoanWithTimestamp(loanID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if l, ok := s.loans[loanID]; ok {
		now := time.Now()
		l.IsSettled = true
		l.SettledAt = &now
	}
}

// GetActiveLoansByFarmer returns all active (unsettled) loans for a farmer.
func (s *Store) GetActiveLoansByFarmer(farmerID string) []*Loan {
	id := normalizeFarmerID(farmerID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*Loan
	for _, l := range s.loans {
		if l.FarmerID == id && !l.IsSettled {
			result = append(result, l)
		}
	}
	return result
}

// ---- Market Repository -------------------------------------------------------

func (s *Store) GetCommodityPrice(commodity string) (CommodityMarket, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.commodities[commodity]
	if !ok {
		return CommodityMarket{}, false
	}
	history := make([]float64, len(c.PriceHistory))
	copy(history, c.PriceHistory)
	return CommodityMarket{
		Commodity: c.Commodity, CurrentPrice: c.CurrentPrice,
		PriceMin: c.PriceMin, PriceMax: c.PriceMax,
		TargetThreshold: c.TargetThreshold, PriceHistory: history,
		Timestamp: c.Timestamp, Volatility: c.Volatility,
	}, true
}

// GetMarketPrice is the legacy alias — returns Maize price for compatibility.
func (s *Store) GetMarketPrice() CommodityMarket {
	c, _ := s.GetCommodityPrice("Maize")
	return c
}

func (s *Store) GetAllMarketPrices() []CommodityMarket {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]CommodityMarket, 0, len(s.commodities))
	for _, c := range s.commodities {
		history := make([]float64, len(c.PriceHistory))
		copy(history, c.PriceHistory)
		result = append(result, CommodityMarket{
			Commodity: c.Commodity, CurrentPrice: c.CurrentPrice,
			PriceMin: c.PriceMin, PriceMax: c.PriceMax,
			TargetThreshold: c.TargetThreshold, PriceHistory: history,
			Timestamp: c.Timestamp, Volatility: c.Volatility,
		})
	}
	return result
}

func (s *Store) UpdateCommodityPrice(commodity string, price float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.commodities[commodity]
	if !ok {
		return
	}
	c.CurrentPrice = price
	c.Timestamp = time.Now()
	c.PriceHistory = append(c.PriceHistory, price)
	if len(c.PriceHistory) > 30 {
		c.PriceHistory = c.PriceHistory[1:]
	}
}

// ---- Log Repository ----------------------------------------------------------

func (s *Store) AppendLog(entry AgentLogEntry) {
	s.mu.Lock()
	s.logs = append(s.logs, entry)
	s.mu.Unlock()

	s.listenerMu.Lock()
	defer s.listenerMu.Unlock()
	for _, ch := range s.logListeners {
		select {
		case ch <- entry:
		default:
		}
	}
}

func (s *Store) GetLogs() []AgentLogEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snapshot := make([]AgentLogEntry, len(s.logs))
	copy(snapshot, s.logs)
	return snapshot
}

func (s *Store) AddLogListener(ch chan AgentLogEntry) {
	s.listenerMu.Lock()
	defer s.listenerMu.Unlock()
	s.logListeners = append(s.logListeners, ch)
}

func (s *Store) RemoveLogListener(ch chan AgentLogEntry) {
	s.listenerMu.Lock()
	defer s.listenerMu.Unlock()
	updated := make([]chan AgentLogEntry, 0, len(s.logListeners))
	for _, listener := range s.logListeners {
		if listener != ch {
			updated = append(updated, listener)
		}
	}
	s.logListeners = updated
}

// ---- Seed Data ---------------------------------------------------------------

func (s *Store) SeedDemoData() {
	seedPrice := 2800.0

	// Register demo farmers
	s.RegisterOrGetFarmer(FarmerLoginRequest{NationalID: "12345678", FullName: "Wanjiku Kamau", PhoneNumber: "+254712345678"})
	s.RegisterOrGetFarmer(FarmerLoginRequest{NationalID: "87654321", FullName: "Otieno Ochieng", PhoneNumber: "+254798765432"})
	s.RegisterOrGetFarmer(FarmerLoginRequest{NationalID: "11223344", FullName: "Aisha Mohamed", PhoneNumber: "+254733112233"})

	// Boost credit scores on demo farmers (simulate history)
	s.mu.Lock()
	if f := s.farmers["12345678"]; f != nil {
		f.CreditScore = 720; f.CreditBand = BandGold; f.LoansSettled = 8; f.WalletBalance = 45000
	}
	if f := s.farmers["87654321"]; f != nil {
		f.CreditScore = 480; f.CreditBand = BandSilver; f.LoansSettled = 3; f.WalletBalance = 12000
	}
	if f := s.farmers["11223344"]; f != nil {
		f.CreditScore = 310; f.CreditBand = BandBronze; f.LoansSettled = 1; f.WalletBalance = 3000
	}
	s.mu.Unlock()

	// F001 = 12345678 — AVAILABLE receipt
	s.CreateReceipt(ReceiptCreateRequest{FarmerID: "12345678", CommodityType: "Maize", QuantityBags: 100, GradeInfo: "Grade 1 — Moisture 12.8%"}, seedPrice)

	// F002 = 87654321 — LOCKED + active loan (30 days backdated)
	r2 := s.CreateReceipt(ReceiptCreateRequest{FarmerID: "87654321", CommodityType: "Maize", QuantityBags: 80, GradeInfo: "Grade 1 — Moisture 13.1%"}, seedPrice)
	s.mu.Lock()
	s.receipts[r2.ID].CreatedAt = time.Now().Add(-30 * 24 * time.Hour)
	s.receipts[r2.ID].Status = StatusLockedCollateral
	s.mu.Unlock()
	s.CreateLoan(r2.ID, "87654321", 134400) // 60% × (80 × 2800)

	// F003 = 11223344 — SETTLED (shows lifecycle)
	r3 := s.CreateReceipt(ReceiptCreateRequest{FarmerID: "11223344", CommodityType: "Wheat", QuantityBags: 50, GradeInfo: "Grade 2 — Moisture 13.4%"}, seedPrice)
	s.mu.Lock()
	s.receipts[r3.ID].Status = StatusSettled
	s.mu.Unlock()

	// Also seed a Wheat receipt for the Gold-tier farmer
	s.CreateReceipt(ReceiptCreateRequest{FarmerID: "12345678", CommodityType: "Wheat", QuantityBags: 60, GradeInfo: "Grade 1 — Moisture 12.1%"}, 3800.0)
}
