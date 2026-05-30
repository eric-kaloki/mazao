// Package main — agent.go
// Phase 3: Multi-commodity price simulation + auto-sell toggle + arbitration agent.
package main

import (
	"fmt"
	"math"
	"math/rand"
	"time"
)

const (
	tickInterval  = 5 * time.Second
	cycleTicks    = 40
	arbCheckTicks = 6 // arbitration runs every 6 ticks (~30 simulated days)
)

// Agent holds state for the autonomous background goroutine.
type Agent struct {
	store    *Store
	tickNum  int
	settled  map[string]bool // commodity → settled this cycle
}

func StartMonitoring(store *Store) {
	a := &Agent{
		store:   store,
		settled: make(map[string]bool),
	}
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogInfo,
		Message: "🚀 MazaoPlus Autonomous Market Agent started — monitoring 5 commodities"})
	store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogInfo,
		Message: fmt.Sprintf("⏱  Tick: %s | Settlement: auto per-commodity threshold | Arbitration: every %d ticks", tickInterval, arbCheckTicks)})

	for _, c := range defaultCommodities {
		store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogInfo,
			Message: fmt.Sprintf("📊 %s | KES %.0f–%.0f | ⚡ threshold KES %.0f", c.Commodity, c.PriceMin, c.PriceMax, c.TargetThreshold)})
	}

	for range ticker.C {
		a.tick()
	}
}

func (a *Agent) tick() {
	a.tickNum++

	// ---- Update all commodity prices ----------------------------------------
	prices := a.store.GetAllMarketPrices()
	for _, mkt := range prices {
		// Independent sine wave per commodity, offset by a stable phase shift
		phaseDeg := (2 * math.Pi * float64(a.tickNum)) / float64(cycleTicks)
		// Different commodities lead/lag by commodity-specific offsets
		phaseOffset := map[string]float64{
			"Maize": -math.Pi / 2, "Wheat": math.Pi / 4,
			"Sorghum": -math.Pi, "Millet": math.Pi / 6, "Rice": math.Pi / 3,
		}[mkt.Commodity]

		midpoint := (mkt.PriceMin + mkt.PriceMax) / 2
		amplitude := (mkt.PriceMax - mkt.PriceMin) / 2
		base := midpoint + amplitude*math.Sin(phaseDeg+phaseOffset)

		noise := (rand.Float64()*2 - 1) * mkt.Volatility * base
		price := math.Round((base+noise)*100) / 100
		if price < mkt.PriceMin {
			price = mkt.PriceMin
		}
		if price > mkt.PriceMax {
			price = mkt.PriceMax
		}

		a.store.UpdateCommodityPrice(mkt.Commodity, price)

		// Only log Maize price every tick, others every 3 ticks (reduce noise)
		if mkt.Commodity == "Maize" || a.tickNum%3 == 0 {
			direction := "📈"
			if price < mkt.CurrentPrice {
				direction = "📉"
			}
			a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogInfo,
				Message: fmt.Sprintf("%s Day %d | %s: KES %.2f/bag (threshold KES %.0f)",
					direction, a.tickNum, mkt.Commodity, price, mkt.TargetThreshold)})
		}

		// ---- Settlement check per commodity -----------------------------------
		if price >= mkt.TargetThreshold {
			if !a.settled[mkt.Commodity] {
				a.settled[mkt.Commodity] = true
				a.triggerSettlement(mkt.Commodity, price)
			}
		} else {
			a.settled[mkt.Commodity] = false
		}
	}

	// ---- Arbitration check ---------------------------------------------------
	if a.tickNum%arbCheckTicks == 0 {
		a.runArbitration()
	}
}

// triggerSettlement settles all auto-sell-enabled receipts for a commodity.
func (a *Agent) triggerSettlement(commodity string, marketPrice float64) {
	a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogTrigger,
		Message: fmt.Sprintf("🔔 %s THRESHOLD BREACH — KES %.2f ≥ threshold — initiating settlement loop", commodity, marketPrice)})

	locked := a.store.GetLockedReceipts()
	var eligible []*ProduceReceipt
	for _, r := range locked {
		if r.CommodityType == commodity && r.AutoSellEnabled {
			eligible = append(eligible, r)
		}
	}

	// Count opted-out receipts for transparency
	optedOut := 0
	for _, r := range locked {
		if r.CommodityType == commodity && !r.AutoSellEnabled {
			optedOut++
		}
	}

	if optedOut > 0 {
		a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogWarn,
			Message: fmt.Sprintf("⏸  %d %s receipt(s) have auto-sell DISABLED — farmer-initiated sale required", optedOut, commodity)})
	}

	if len(eligible) == 0 {
		a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogWarn,
			Message: fmt.Sprintf("⚠️  No auto-sell eligible %s receipts — settlement idle", commodity)})
		return
	}

	a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogTrigger,
		Message: fmt.Sprintf("📋 Settling %d %s receipt(s)", len(eligible), commodity)})

	totalNet := 0.0
	for _, receipt := range eligible {
		result := calculateSettlement(a.store, receipt, marketPrice)
		logSettlementBreakdown(a.store, result)

		if err := a.store.SettleReceiptWithTimestamp(receipt.ID); err != nil {
			a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogError,
				Message: fmt.Sprintf("✗ Failed to settle receipt %s: %v", receipt.ID[:8], err)})
			continue
		}
		if loan, ok := a.store.GetLoanByReceipt(receipt.ID); ok {
			a.store.SettleLoanWithTimestamp(loan.ID)
		}

		// Credit wallet
		a.store.CreditFarmerWallet(receipt.FarmerID,
			fmt.Sprintf("%s settlement — %d bags × KES %.2f", commodity, receipt.QuantityBags, marketPrice),
			result.NetProfit)
		a.store.IncrementLoansSettled(receipt.FarmerID)
		a.store.RecalculateCreditScore(receipt.FarmerID)

		txID := fmt.Sprintf("MP%d", time.Now().UnixMilli()%1000000)
		a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogPayout,
			Message: fmt.Sprintf("💸 M-PESA B2C | TxID: %s | To: %s | Net: KES %.2f | Status: SUCCESS", txID, receipt.FarmerID, result.NetProfit)})

		totalNet += result.NetProfit
	}

	a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogPayout,
		Message: fmt.Sprintf("✅ %s settlement done — %d receipt(s) cleared | Total disbursed: KES %.2f", commodity, len(eligible), totalNet)})
}

// runArbitration checks for underwater or near-expired receipts and reconciles.
func (a *Agent) runArbitration() {
	a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogArbitration,
		Message: "🏛  Arbitration agent woke — scanning for underwater / near-expiry positions"})

	locked := a.store.GetLockedReceipts()
	if len(locked) == 0 {
		return
	}

	reconciled := 0
	for _, r := range locked {
		mkt, ok := a.store.GetCommodityPrice(r.CommodityType)
		if !ok {
			continue
		}

		loan, hasLoan := a.store.GetLoanByReceipt(r.ID)
		if !hasLoan {
			continue
		}

		daysElapsed := time.Since(r.CreatedAt).Hours() / 24
		currentValue := float64(r.QuantityBags) * mkt.CurrentPrice
		accrualFraction := daysElapsed / 365
		interest := loan.PrincipalAmount * loan.InterestRate * accrualFraction
		storageFee := float64(r.QuantityBags) * r.HoldingCostPerBagMonth * (daysElapsed / 30)
		totalDebt := loan.PrincipalAmount + interest + storageFee
		ltv := totalDebt / currentValue

		// Flag cases: LTV > 90% or position > 85 days
		if ltv > 0.90 || daysElapsed > 85 {
			a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogArbitration,
				Message: fmt.Sprintf("⚖️  Receipt %s | Farmer: %s | LTV: %.1f%% | Days: %.0f | Value: KES %.2f vs Debt: KES %.2f",
					r.ID[:8], r.FarmerID, ltv*100, daysElapsed, currentValue, totalDebt)})

			if currentValue < totalDebt {
				a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogArbitration,
					Message: fmt.Sprintf("  ⚠️  UNDERWATER POSITION — %s (%s) | Shortfall: KES %.2f | Recommendation: immediate partial settlement",
						r.ID[:8], r.FarmerID, totalDebt-currentValue)})
			} else {
				a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogArbitration,
					Message: fmt.Sprintf("  ✓  Near-threshold | %s (%s) | Surplus: KES %.2f | Farmer notified for manual action",
						r.ID[:8], r.FarmerID, currentValue-totalDebt)})
			}
			reconciled++
		}
	}

	if reconciled == 0 {
		a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogArbitration,
			Message: "✅ Arbitration complete — all positions healthy"})
	} else {
		a.store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogArbitration,
			Message: fmt.Sprintf("📋 Arbitration reviewed %d position(s) — check terminal for details", reconciled)})
	}
}

// ---- Settlement Calculation (shared by agent + manual sell handler) ----------

// calculateSettlement computes the full ledger for one receipt at a given price.
func calculateSettlement(store *Store, receipt *ProduceReceipt, marketPrice float64) SettlementResult {
	daysElapsed := time.Since(receipt.CreatedAt).Hours() / 24
	grossRevenue := float64(receipt.QuantityBags) * marketPrice
	platformFee := grossRevenue * 0.01 // 1% platform fee

	storageFee := float64(receipt.QuantityBags) * receipt.HoldingCostPerBagMonth * (daysElapsed / 30)

	var principal, interest float64
	if loan, ok := store.GetLoanByReceipt(receipt.ID); ok {
		principal = loan.PrincipalAmount
		interest = loan.PrincipalAmount * loan.InterestRate * (daysElapsed / 365)
	}

	totalDebt := principal + interest + storageFee + platformFee
	netProfit := grossRevenue - totalDebt
	if netProfit < 0 {
		netProfit = 0
	}

	return SettlementResult{
		ReceiptID:    receipt.ID,
		FarmerID:     receipt.FarmerID,
		SalePrice:    math.Round(marketPrice*100) / 100,
		GrossRevenue: math.Round(grossRevenue*100) / 100,
		Principal:    math.Round(principal*100) / 100,
		Interest:     math.Round(interest*100) / 100,
		StorageFee:   math.Round(storageFee*100) / 100,
		PlatformFee:  math.Round(platformFee*100) / 100,
		TotalDebt:    math.Round(totalDebt*100) / 100,
		NetProfit:    math.Round(netProfit*100) / 100,
		DaysElapsed:  math.Round(daysElapsed*10) / 10,
	}
}

// logSettlementBreakdown emits the full ledger to the terminal log.
func logSettlementBreakdown(store *Store, r SettlementResult) {
	store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogTrigger,
		Message: fmt.Sprintf("  ├─ Receipt %s | Farmer %s | %.0f bags × KES %.2f = Gross KES %.2f",
			r.ReceiptID[:8], r.FarmerID, float64(0), r.SalePrice, r.GrossRevenue)})
	store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogTrigger,
		Message: fmt.Sprintf("  ├─ Deductions: Principal KES %.2f + Interest KES %.2f + Storage KES %.2f + Platform 1%% KES %.2f",
			r.Principal, r.Interest, r.StorageFee, r.PlatformFee)})
	store.AppendLog(AgentLogEntry{Timestamp: time.Now(), Level: LogTrigger,
		Message: fmt.Sprintf("  └─ NET PROFIT: KES %.2f → farmer wallet", r.NetProfit)})
}
