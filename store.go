// Package main — store.go
// Thread-safe in-memory repository. All mutations are guarded by sync.RWMutex.
// Replaces a DB for Hack Day speed — zero I/O latency.
package main

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Store is the single source of truth for all application state.
type Store struct {
	mu           sync.RWMutex
	receipts     map[string]*ProduceReceipt // keyed by receipt ID
	loans        map[string]*Loan           // keyed by loan ID
	marketPrice  *MarketPrice
	logs         []AgentLogEntry
	logListeners []chan AgentLogEntry // SSE subscriber channels
	listenerMu   sync.Mutex
}

// NewStore initialises an empty store with a default market price struct.
func NewStore() *Store {
	return &Store{
		receipts: make(map[string]*ProduceReceipt),
		loans:    make(map[string]*Loan),
		marketPrice: &MarketPrice{
			Commodity:       "Maize",
			CurrentPrice:    2800,
			TargetThreshold: 3500,
			PriceHistory:    []float64{},
			Timestamp:       time.Now(),
		},
		logs: []AgentLogEntry{},
	}
}

// normalizeFarmerID trims whitespace and uppercases a farmer ID for consistent storage/lookup.
func normalizeFarmerID(id string) string {
	return strings.ToUpper(strings.TrimSpace(id))
}

// ---- Receipt Repository ------------------------------------------------------

// CreateReceipt persists a new receipt with AVAILABLE status.
// priceAtDeposit captures the market price at the moment of warehouse entry.
// This value is frozen and used as the basis for loan calculations — it does
// NOT change as the market fluctuates.
func (s *Store) CreateReceipt(req ReceiptCreateRequest, priceAtDeposit float64) *ProduceReceipt {
	farmerID := normalizeFarmerID(req.FarmerID)
	depositValue := float64(req.QuantityBags) * priceAtDeposit

	receipt := &ProduceReceipt{
		ID:                     uuid.NewString(),
		FarmerID:               farmerID,
		CommodityType:          req.CommodityType,
		QuantityBags:           req.QuantityBags,
		GradeInfo:              req.GradeInfo,
		HoldingCostPerBagMonth: 10.0, // KES 10 per bag per month
		PriceAtDeposit:         priceAtDeposit,
		DepositValueKES:        depositValue,
		Status:                 StatusAvailable,
		CreatedAt:              time.Now(),
	}
	s.mu.Lock()
	s.receipts[receipt.ID] = receipt
	s.mu.Unlock()
	return receipt
}

// GetReceiptsByFarmer returns all receipts belonging to a farmer.
// farmerID is normalized before comparison.
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

// GetReceipt returns a single receipt by ID.
func (s *Store) GetReceipt(id string) (*ProduceReceipt, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.receipts[id]
	return r, ok
}

// GetLockedReceipts returns all receipts currently in LOCKED_COLLATERAL state.
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

// AtomicLockAndLoan performs a race-safe atomic operation:
// 1. Verifies receipt is AVAILABLE and belongs to farmerID
// 2. Checks no active loan exists
// 3. Transitions status to LOCKED_COLLATERAL
// 4. Creates a Loan record
// All steps execute under a single write lock to prevent duplicate applications.
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

	// Check for existing active loan within the same lock
	for _, l := range s.loans {
		if l.ReceiptID == receiptID && !l.IsSettled {
			return nil, fmt.Errorf("an active loan already exists for this receipt")
		}
	}

	// Transition: AVAILABLE → LOCKED_COLLATERAL
	r.Status = StatusLockedCollateral

	// Create the loan record
	loan := &Loan{
		ID:              uuid.NewString(),
		ReceiptID:       receiptID,
		FarmerID:        normalized,
		PrincipalAmount: principal,
		InterestRate:    0.08, // 8% annual, fixed
		IsSettled:       false,
		CreatedAt:       time.Now(),
	}
	s.loans[loan.ID] = loan
	return loan, nil
}

// SettleReceipt transitions a receipt from LOCKED_COLLATERAL → SETTLED.
// Called exclusively by the autonomous agent.
func (s *Store) SettleReceipt(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.receipts[id]
	if !ok {
		return fmt.Errorf("receipt %s not found", id)
	}
	if r.Status != StatusLockedCollateral {
		return fmt.Errorf("receipt %s is not LOCKED_COLLATERAL (current: %s)", id, r.Status)
	}
	r.Status = StatusSettled
	return nil
}

// ---- Loan Repository ---------------------------------------------------------

// CreateLoan records a new loan record. For seeding only.
// Production code should use AtomicLockAndLoan instead.
func (s *Store) CreateLoan(receiptID, farmerID string, principal float64) *Loan {
	loan := &Loan{
		ID:              uuid.NewString(),
		ReceiptID:       receiptID,
		FarmerID:        normalizeFarmerID(farmerID),
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

// GetLoanByReceipt returns the active (unsettled) loan for a given receipt.
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

// SettleLoan marks a loan as settled. Called by the agent during liquidation.
func (s *Store) SettleLoan(loanID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if l, ok := s.loans[loanID]; ok {
		l.IsSettled = true
	}
}

// ---- Market Price Repository -------------------------------------------------

// GetMarketPrice returns the current market price snapshot (read-safe copy).
func (s *Store) GetMarketPrice() MarketPrice {
	s.mu.RLock()
	defer s.mu.RUnlock()
	history := make([]float64, len(s.marketPrice.PriceHistory))
	copy(history, s.marketPrice.PriceHistory)
	return MarketPrice{
		Commodity:       s.marketPrice.Commodity,
		CurrentPrice:    s.marketPrice.CurrentPrice,
		TargetThreshold: s.marketPrice.TargetThreshold,
		PriceHistory:    history,
		Timestamp:       s.marketPrice.Timestamp,
	}
}

// UpdateMarketPrice sets the latest simulated price and appends it to history.
// Keeps the history window at 30 ticks.
func (s *Store) UpdateMarketPrice(price float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.marketPrice.CurrentPrice = price
	s.marketPrice.Timestamp = time.Now()
	s.marketPrice.PriceHistory = append(s.marketPrice.PriceHistory, price)
	if len(s.marketPrice.PriceHistory) > 30 {
		s.marketPrice.PriceHistory = s.marketPrice.PriceHistory[1:]
	}
}

// ---- Agent Log Repository & SSE Fan-out --------------------------------------

// AppendLog records a log entry and fans it out to all live SSE subscribers.
// The listener is registered BEFORE the log is appended to avoid the replay race:
// new entries are always buffered in the client channel, and historical replay
// sends them in order after registration.
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
			// Slow consumer — drop rather than block the agent
		}
	}
}

// GetLogs returns a snapshot of all historical log entries.
func (s *Store) GetLogs() []AgentLogEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snapshot := make([]AgentLogEntry, len(s.logs))
	copy(snapshot, s.logs)
	return snapshot
}

// AddLogListener registers a channel to receive future log entries via SSE.
func (s *Store) AddLogListener(ch chan AgentLogEntry) {
	s.listenerMu.Lock()
	defer s.listenerMu.Unlock()
	s.logListeners = append(s.logListeners, ch)
}

// RemoveLogListener de-registers a channel when an SSE client disconnects.
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

// SeedDemoData populates the store with realistic demo data for Hack Day judges.
// Prices are frozen at deposit time — seed price simulates a past market entry.
func (s *Store) SeedDemoData() {
	seedPrice := 2800.0 // KES per bag — market price at time of warehouse entry

	// Farmer F001 — one AVAILABLE receipt (ready for loan application)
	s.CreateReceipt(ReceiptCreateRequest{
		FarmerID:      "F001",
		CommodityType: "Maize",
		QuantityBags:  100,
		GradeInfo:     "Grade 1 — Moisture 12.8%",
	}, seedPrice)

	// Farmer F002 — receipt already LOCKED_COLLATERAL with an active loan
	// Backdated 30 days to simulate days of storage and accrued fees
	r2 := s.CreateReceipt(ReceiptCreateRequest{
		FarmerID:      "F002",
		CommodityType: "Maize",
		QuantityBags:  80,
		GradeInfo:     "Grade 1 — Moisture 13.1%",
	}, seedPrice)
	s.mu.Lock()
	s.receipts[r2.ID].CreatedAt = time.Now().Add(-30 * 24 * time.Hour)
	s.receipts[r2.ID].Status = StatusLockedCollateral
	s.mu.Unlock()
	// Loan: 60% of deposit value = 60% × (80 bags × 2800) = 60% × 224,000 = 134,400
	s.CreateLoan(r2.ID, "F002", 134400)

	// Farmer F003 — one already SETTLED receipt (shows full lifecycle)
	r3 := s.CreateReceipt(ReceiptCreateRequest{
		FarmerID:      "F003",
		CommodityType: "Wheat",
		QuantityBags:  50,
		GradeInfo:     "Grade 2 — Moisture 13.4%",
	}, seedPrice)
	s.mu.Lock()
	s.receipts[r3.ID].Status = StatusSettled
	s.mu.Unlock()
}
