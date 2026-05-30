import React, { useState, useEffect, useCallback, useRef } from 'react'
import { User, Search, TrendingUp, Lock, CheckCircle, AlertCircle, Coins, RefreshCw } from 'lucide-react'
import {
  getFarmerReceipts,
  applyForLoan,
  getMarketStatus,
  type EnrichedReceipt,
  type MarketPrice,
  type LoanApplicationResponse,
  formatKES,
} from '../api/client'
import './FarmerDashboard.css'

const DEMO_FARMERS = ['F001', 'F002', 'F003']

export default function FarmerDashboard() {
  const [farmerId, setFarmerId] = useState('')
  const [receipts, setReceipts] = useState<EnrichedReceipt[]>([])
  const [market, setMarket] = useState<MarketPrice | null>(null)
  const [loading, setLoading] = useState(false)
  const [loanLoading, setLoanLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loanResult, setLoanResult] = useState<LoanApplicationResponse | null>(null)
  const [searched, setSearched] = useState(false)
  // Track current farmer ID to avoid stale-closure issues in auto-refresh
  const currentFarmerRef = useRef('')

  // Poll market price every 3s for the price bar display
  useEffect(() => {
    const fetch = () => getMarketStatus().then(setMarket).catch(() => {})
    fetch()
    const interval = setInterval(fetch, 3000)
    return () => clearInterval(interval)
  }, [])

  const fetchReceipts = useCallback(async (id: string, silent = false) => {
    const normalized = id.trim().toUpperCase()
    if (!normalized) return
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await getFarmerReceipts(normalized)
      setReceipts(data.receipts)
      setSearched(true)
      currentFarmerRef.current = normalized
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to fetch receipts')
        setReceipts([])
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Auto-refresh every 5s when at least one receipt is LOCKED_COLLATERAL
  // so the UI updates when the agent settles without a manual refresh
  useEffect(() => {
    const hasLocked = receipts.some(r => r.status === 'LOCKED_COLLATERAL')
    if (!hasLocked || !currentFarmerRef.current) return
    const interval = setInterval(() => {
      fetchReceipts(currentFarmerRef.current, true /* silent */)
    }, 5000)
    return () => clearInterval(interval)
  }, [receipts, fetchReceipts])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchReceipts(farmerId)
  }

  const handleDemoClick = (id: string) => {
    setFarmerId(id)
    fetchReceipts(id)
  }

  const handleApplyLoan = async (receipt: EnrichedReceipt) => {
    if (loanLoading) return // prevent double-click
    setLoanLoading(receipt.id)
    setLoanResult(null)
    setError(null)
    try {
      const result = await applyForLoan({ receipt_id: receipt.id, farmer_id: receipt.farmer_id })
      setLoanResult(result)
      await fetchReceipts(farmerId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Loan application failed')
    } finally {
      setLoanLoading(null)
    }
  }

  const currentPrice = market?.current_price ?? 0
  const threshold = market?.target_threshold ?? 3500
  const pricePercent = ((currentPrice - 2500) / (4500 - 2500)) * 100
  const hasLocked = receipts.some(r => r.status === 'LOCKED_COLLATERAL')

  return (
    <div className="farmer-layout">
      {/* ---- Page Header --------------------------------------------------- */}
      <div className="page-header animate-in">
        <div className="page-header-icon">
          <User size={28} />
        </div>
        <div>
          <h2 className="page-title">Farmer Dashboard</h2>
          <p className="page-subtitle">
            View your active deposits, entry valuations, and apply for instant M-Pesa micro-loans
          </p>
        </div>
        {hasLocked && (
          <div className="auto-refresh-badge">
            <RefreshCw size={12} className="spin-slow" /> Auto-refreshing
          </div>
        )}
      </div>

      {/* ---- Market Price Bar ---------------------------------------------- */}
      {market && (
        <div className="market-bar glass-card animate-in">
          <div className="market-bar-info">
            <TrendingUp size={16} />
            <span className="market-bar-label">Live Maize Spot Price</span>
          </div>
          <div className="market-bar-price">
            <span className="market-price-value">{formatKES(currentPrice)}</span>
            <span className="market-price-unit">/ 90kg bag</span>
          </div>
          <div className="market-bar-track">
            <div className="market-bar-rail">
              <div
                className="market-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, pricePercent))}%` }}
              />
              <div
                className="market-bar-threshold"
                style={{ left: `${((threshold - 2500) / (4500 - 2500)) * 100}%` }}
                title={`Settlement threshold: ${formatKES(threshold)}`}
              />
            </div>
            <div className="market-bar-labels">
              <span>KES 2,500</span>
              <span className="threshold-label">⚡ {formatKES(threshold)}</span>
              <span>KES 4,500</span>
            </div>
          </div>
        </div>
      )}

      {/* ---- Farmer Search ------------------------------------------------- */}
      <div className="glass-card search-card animate-in">
        <form id="farmer-search-form" onSubmit={handleSearch} className="search-form">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label" htmlFor="farmer-id-input">Farmer ID</label>
            <input
              id="farmer-id-input"
              type="text"
              className="input-field"
              placeholder="Enter Farmer ID (e.g. F001)"
              value={farmerId}
              onChange={(e) => setFarmerId(e.target.value.toUpperCase())}
              required
            />
          </div>
          <button
            type="submit"
            id="search-farmer-btn"
            className="btn btn-primary search-btn"
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : <Search size={16} />}
            {loading ? 'Searching…' : 'Lookup'}
          </button>
        </form>

        <div className="demo-shortcuts">
          <span className="demo-label">Demo farmers:</span>
          {DEMO_FARMERS.map((id) => (
            <button
              key={id}
              id={`demo-farmer-${id.toLowerCase()}`}
              className="btn btn-outline demo-shortcut"
              onClick={() => handleDemoClick(id)}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Error --------------------------------------------------------- */}
      {error && (
        <div className="form-error animate-in" style={{ borderRadius: 'var(--radius-md)' }}>
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {/* ---- Loan Success Banner ------------------------------------------- */}
      {loanResult && (
        <div className="loan-success glass-card animate-in">
          <div className="loan-success-icon"><Coins size={32} /></div>
          <div className="loan-success-body">
            <h3>M-Pesa Advance Disbursed!</h3>
            <p>
              <strong>{formatKES(loanResult.disbursed_kes)}</strong> instantly sent to your M-Pesa.
              Based on deposit value {formatKES(loanResult.deposit_value_kes)} × {loanResult.ltv_percent}% LTV —
              this amount is <strong>fixed</strong> regardless of market movement.
            </p>
          </div>
          <CheckCircle size={24} className="loan-success-check" />
        </div>
      )}

      {/* ---- Empty State --------------------------------------------------- */}
      {searched && receipts.length === 0 && !loading && (
        <div className="empty-state animate-in">
          <div className="empty-icon">📭</div>
          <p>No receipts found for farmer <strong>{farmerId.toUpperCase()}</strong></p>
          <p className="empty-sub">Visit the Warehouse Portal to log a new deposit</p>
        </div>
      )}

      {/* ---- Receipts Grid ------------------------------------------------- */}
      {receipts.length > 0 && (
        <div className="receipts-grid">
          {receipts.map((r, i) => (
            <ReceiptCard
              key={r.id}
              receipt={r}
              market={market}
              loanLoading={loanLoading}
              onApplyLoan={handleApplyLoan}
              animDelay={i * 80}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- ReceiptCard -------------------------------------------------------------

interface ReceiptCardProps {
  receipt: EnrichedReceipt
  market: MarketPrice | null
  loanLoading: string | null
  onApplyLoan: (r: EnrichedReceipt) => void
  animDelay: number
}

function ReceiptCard({ receipt: r, market, loanLoading, onApplyLoan, animDelay }: ReceiptCardProps) {
  const livePrice = market?.current_price ?? r.current_price_kes
  const liveValue = r.quantity_bags * livePrice

  // Storage fee: accrued from created_at to now
  const daysStored = Math.max(0, (Date.now() - new Date(r.created_at).getTime()) / 86400000)
  const storageFee = daysStored * r.quantity_bags * (r.holding_cost_per_bag_month / 30)

  // For AVAILABLE receipts: loan ceiling is based on deposit price (frozen), not live
  const depositBasedMaxLoan = r.deposit_value_kes * 0.60

  const statusBadge = {
    AVAILABLE:         { label: 'Available',   cls: 'badge-available' },
    LOCKED_COLLATERAL: { label: 'Locked',       cls: 'badge-locked' },
    SETTLED:           { label: 'Settled',      cls: 'badge-settled' },
  }[r.status]

  return (
    <div
      className={`receipt-card glass-card animate-in receipt-card--${r.status.toLowerCase()}`}
      style={{ animationDelay: `${animDelay}ms` }}
      id={`receipt-card-${r.id.substring(0, 8)}`}
    >
      {/* Header */}
      <div className="rc-header">
        <div>
          <div className="rc-id">#{r.id.substring(0, 8).toUpperCase()}</div>
          <div className="rc-commodity">{r.quantity_bags} bags · {r.commodity_type}</div>
        </div>
        <span className={`badge ${statusBadge.cls}`}>
          <span className="badge-dot" />
          {statusBadge.label}
        </span>
      </div>

      {/* Grade */}
      <div className="rc-grade">{r.grade_info}</div>

      {/* Financial metrics — content depends on receipt status */}
      {r.status === 'AVAILABLE' && (
        <>
          <div className="rc-metrics">
            <div className="rc-metric">
              <span className="rc-metric-label">Entry Price</span>
              <span className="rc-metric-value">{formatKES(r.price_at_deposit)}/bag</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Deposit Value</span>
              <span className="rc-metric-value">{formatKES(r.deposit_value_kes)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Live Market Value</span>
              <span className="rc-metric-value rc-metric-live">{formatKES(liveValue)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Max Loan (60% of entry)</span>
              <span className="rc-metric-value rc-metric-gold">{formatKES(depositBasedMaxLoan)}</span>
            </div>
          </div>
          <div className="rc-price-note">
            💡 Loan based on entry price (KES {r.price_at_deposit.toFixed(0)}/bag) — not affected by market changes
          </div>
        </>
      )}

      {r.status === 'LOCKED_COLLATERAL' && r.active_loan && (
        <>
          <div className="rc-metrics">
            <div className="rc-metric">
              <span className="rc-metric-label">Entry Price</span>
              <span className="rc-metric-value">{formatKES(r.price_at_deposit)}/bag</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Loan Issued</span>
              <span className="rc-metric-value rc-metric-gold">{formatKES(r.active_loan.principal_amount)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Days Stored</span>
              <span className="rc-metric-value">{Math.floor(daysStored)}d</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Accrued Storage Fee</span>
              <span className="rc-metric-value">{formatKES(storageFee)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Current Market Value</span>
              <span className="rc-metric-value rc-metric-live">{formatKES(liveValue)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Interest Rate</span>
              <span className="rc-metric-value">{(r.active_loan.interest_rate * 100).toFixed(0)}% p.a.</span>
            </div>
          </div>
          <div className="rc-loan-badge">
            <Lock size={12} />
            <span>Fixed loan: {formatKES(r.active_loan.principal_amount)} — agent monitoring for KES 3,500 peak</span>
          </div>
        </>
      )}

      {r.status === 'SETTLED' && (
        <div className="rc-metrics">
          <div className="rc-metric">
            <span className="rc-metric-label">Entry Price</span>
            <span className="rc-metric-value">{formatKES(r.price_at_deposit)}/bag</span>
          </div>
          <div className="rc-metric">
            <span className="rc-metric-label">Deposit Value</span>
            <span className="rc-metric-value">{formatKES(r.deposit_value_kes)}</span>
          </div>
        </div>
      )}

      {/* CTA */}
      {r.status === 'AVAILABLE' && (
        <button
          id={`apply-loan-${r.id.substring(0, 8)}`}
          className="btn btn-gold apply-btn"
          disabled={loanLoading !== null}
          onClick={() => onApplyLoan(r)}
        >
          {loanLoading === r.id ? (
            <><span className="spinner" /> Processing…</>
          ) : (
            <><Coins size={15} /> Apply for M-Pesa Micro-Loan</>
          )}
        </button>
      )}

      {r.status === 'LOCKED_COLLATERAL' && (
        <div className="rc-locked-note">
          <Lock size={13} />
          Locked as collateral — autonomous agent monitoring for KES 3,500 threshold
        </div>
      )}

      {r.status === 'SETTLED' && (
        <div className="rc-settled-note">
          <CheckCircle size={13} />
          Loan cleared · Net profit disbursed via M-Pesa · Warehouse space released
        </div>
      )}
    </div>
  )
}
