// Package main — agent.go
// The Autonomous Market Agent — MazaoPlus's star feature.
// Runs as an independent goroutine, simulating grain market price movements
// inspired by Selina Wamucii price index data (KES 2,500–4,500 / bag).
// When the price crosses the profitable threshold (KES 3,500), it atomically
// settles all LOCKED_COLLATERAL receipts, simulating an M-Pesa B2C payout.
package main

import (
	"fmt"
	"math"
	"math/rand"
	"time"
)

const (
	// tickInterval controls how often the agent "wakes up".
	// 5 seconds = one simulated market day for demo purposes.
	tickInterval = 5 * time.Second

	priceMin       = 2500.0
	priceMax       = 4500.0
	priceThreshold = 3500.0

	// Cycle period — full sinusoidal price cycle in ticks.
	// At 5s per tick, 40 ticks ≈ 3.3 minutes for a full price cycle.
	cycleTicks = 40
)

// Agent holds the stateful components of the background monitoring goroutine.
type Agent struct {
	store    *Store
	tickNum  int     // monotonically increasing tick counter
	settled  bool    // true once a settlement has fired this cycle
}

// StartMonitoring launches the autonomous price-monitoring goroutine.
// It blocks until the program exits — call with `go agent.StartMonitoring(...)`.
func StartMonitoring(store *Store) {
	a := &Agent{store: store}
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogInfo,
		Message:   "🚀 MazaoPlus Autonomous Market Agent started — monitoring Maize prices (Selina Wamucii index)",
	})
	store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogInfo,
		Message:   fmt.Sprintf("📈 Price corridor: KES %.0f – %.0f | Settlement threshold: KES %.0f", priceMin, priceMax, priceThreshold),
	})
	store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogInfo,
		Message:   fmt.Sprintf("⏱  Tick interval: %s (each tick = one simulated market day)", tickInterval),
	})

	for range ticker.C {
		a.tick()
	}
}

// tick runs on every ticker fire — simulates one market day.
func (a *Agent) tick() {
	a.tickNum++

	// ---- Price Simulation -----------------------------------------------
	// Sinusoidal base oscillating between priceMin and priceMax.
	// Phase is offset so the price starts at a trough and naturally rises.
	phase := (2 * math.Pi * float64(a.tickNum)) / float64(cycleTicks)
	// Offset phase by π so we start at trough and rise toward threshold.
	midpoint := (priceMin + priceMax) / 2
	amplitude := (priceMax - priceMin) / 2
	base := midpoint + amplitude*math.Sin(phase-math.Pi/2)

	// Add realistic market noise (±3%)
	noise := (rand.Float64()*0.06 - 0.03) * base
	price := math.Round((base+noise)*100) / 100

	// Clamp to corridor
	if price < priceMin {
		price = priceMin
	}
	if price > priceMax {
		price = priceMax
	}

	a.store.UpdateMarketPrice(price)

	// Direction emoji for visual clarity in the terminal
	prevPrice := a.store.GetMarketPrice().CurrentPrice
	direction := "📈"
	if price < prevPrice {
		direction = "📉"
	}

	a.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogInfo,
		Message: fmt.Sprintf(
			"%s Day %d | Maize spot price: KES %.2f/bag | Threshold: KES %.0f",
			direction, a.tickNum, price, priceThreshold,
		),
	})

	// ---- Settlement Logic -----------------------------------------------
	if price >= priceThreshold {
		if !a.settled {
			// First time crossing threshold this cycle — fire settlement
			a.settled = true
			a.triggerSettlement(price)
		}
	} else {
		// Price fell back below threshold — reset so it can fire again next cycle
		a.settled = false
	}
}

// triggerSettlement atomically processes all LOCKED_COLLATERAL receipts.
// This is the "money shot" for the Hack Day demo.
func (a *Agent) triggerSettlement(marketPrice float64) {
	a.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogTrigger,
		Message: fmt.Sprintf(
			"🔔 THRESHOLD BREACH — Price KES %.2f ≥ KES %.0f — Initiating atomic settlement loop",
			marketPrice, priceThreshold,
		),
	})

	locked := a.store.GetLockedReceipts()

	if len(locked) == 0 {
		a.store.AppendLog(AgentLogEntry{
			Timestamp: time.Now(),
			Level:     LogWarn,
			Message:   "⚠️  No LOCKED_COLLATERAL receipts found — settlement loop idle",
		})
		return
	}

	a.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogTrigger,
		Message:   fmt.Sprintf("📋 Found %d receipt(s) eligible for settlement", len(locked)),
	})

	totalNetProfit := 0.0

	for _, receipt := range locked {
		result := a.calculateSettlement(receipt, marketPrice)

		// Log per-receipt calculation breakdown
		a.store.AppendLog(AgentLogEntry{
			Timestamp: time.Now(),
			Level:     LogTrigger,
			Message: fmt.Sprintf(
				"  ├─ Receipt %s | Farmer %s | %d bags × KES %.2f = Gross KES %.2f",
				receipt.ID[:8], receipt.FarmerID, receipt.QuantityBags, marketPrice, result.GrossRevenue,
			),
		})
		a.store.AppendLog(AgentLogEntry{
			Timestamp: time.Now(),
			Level:     LogTrigger,
			Message: fmt.Sprintf(
				"  ├─ Total Debt: KES %.2f (principal + interest + storage fees)",
				result.TotalDebt,
			),
		})
		a.store.AppendLog(AgentLogEntry{
			Timestamp: time.Now(),
			Level:     LogTrigger,
			Message: fmt.Sprintf(
				"  └─ NET PROFIT: KES %.2f → routing to farmer wallet",
				result.NetProfit,
			),
		})

		// Atomically update state
		if err := a.store.SettleReceipt(receipt.ID); err != nil {
			a.store.AppendLog(AgentLogEntry{
				Timestamp: time.Now(),
				Level:     LogError,
				Message:   fmt.Sprintf("  ✗ Failed to settle receipt %s: %v", receipt.ID[:8], err),
			})
			continue
		}

		// Settle the associated loan
		if loan, ok := a.store.GetLoanByReceipt(receipt.ID); ok {
			a.store.SettleLoan(loan.ID)
		}

		// Simulate M-Pesa B2C payout event
		a.store.AppendLog(AgentLogEntry{
			Timestamp: time.Now(),
			Level:     LogPayout,
			Message: fmt.Sprintf(
				"💸 M-PESA B2C | TransactionID: MP%d | To: %s | Amount: KES %.2f | Status: SUCCESS",
				time.Now().UnixMilli()%1000000, receipt.FarmerID, result.NetProfit,
			),
		})

		totalNetProfit += result.NetProfit
	}

	a.store.AppendLog(AgentLogEntry{
		Timestamp: time.Now(),
		Level:     LogPayout,
		Message: fmt.Sprintf(
			"✅ Settlement complete — %d receipt(s) cleared | Total disbursed: KES %.2f | Warehouse space released",
			len(locked), totalNetProfit,
		),
	})
}

// calculateSettlement computes the gross revenue, total debt, and net profit
// for a single receipt at the given market price.
//
// Formulas:
//
//	GrossRevenue = Bags × CurrentMarketPrice
//	StorageFee   = Bags × HoldingCostPerBagMonth × (DaysElapsed / 30)
//	Debt         = Principal + (Principal × InterestRate × DaysElapsed/365) + StorageFee
//	NetProfit    = GrossRevenue − Debt
func (a *Agent) calculateSettlement(receipt *ProduceReceipt, marketPrice float64) SettlementResult {
	daysElapsed := time.Since(receipt.CreatedAt).Hours() / 24

	grossRevenue := float64(receipt.QuantityBags) * marketPrice

	// Prorated monthly storage fee
	storageFee := float64(receipt.QuantityBags) * receipt.HoldingCostPerBagMonth * (daysElapsed / 30)

	totalDebt := 0.0
	if loan, ok := a.store.GetLoanByReceipt(receipt.ID); ok {
		accrualFraction := daysElapsed / 365
		interest := loan.PrincipalAmount * loan.InterestRate * accrualFraction
		totalDebt = loan.PrincipalAmount + interest + storageFee
	} else {
		// No loan — only storage fee is owed
		totalDebt = storageFee
	}

	netProfit := grossRevenue - totalDebt
	if netProfit < 0 {
		netProfit = 0 // floor at zero — farmer always keeps the grain value
	}

	return SettlementResult{
		ReceiptID:    receipt.ID,
		FarmerID:     receipt.FarmerID,
		GrossRevenue: math.Round(grossRevenue*100) / 100,
		TotalDebt:    math.Round(totalDebt*100) / 100,
		NetProfit:    math.Round(netProfit*100) / 100,
	}
}
