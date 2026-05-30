import React, { useState, useEffect, useCallback } from 'react'
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

  // Poll market price so values update live without full refresh
  useEffect(() => {
    const fetchMarket = () => getMarketStatus().then(setMarket).catch(() => {})
    fetchMarket()
    const interval = setInterval(fetchMarket, 3000)
    return () => clearInterval(interval)
  }, [])

  const fetchReceipts = useCallback(async (id: string) => {
    if (!id.trim()) return
    setLoading(true)
    setError(null)
    setLoanResult(null)
    try {
      const data = await getFarmerReceipts(id.trim().toUpperCase())
      setReceipts(data.receipts || [])
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch receipts')
      setReceipts([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchReceipts(farmerId)
  }

  const handleApplyLoan = async (receipt: EnrichedReceipt) => {
    setLoanLoading(receipt.id)
    setLoanResult(null)
    setError(null)
    try {
      const result = await applyForLoan({ receipt_id: receipt.id, farmer_id: receipt.farmer_id })
      setLoanResult(result)
      // Refresh receipts to reflect new status
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
            View your active deposits, market valuations, and apply for instant M-Pesa micro-loans
          </p>
        </div>
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
              onChange={(e) => setFarmerId(e.target.value)}
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

        {/* Quick demo farmer shortcuts */}
        <div className="demo-shortcuts">
          <span className="demo-label">Demo farmers:</span>
          {DEMO_FARMERS.map((id) => (
            <button
              key={id}
              id={`demo-farmer-${id.toLowerCase()}`}
              className="btn btn-outline demo-shortcut"
              onClick={() => { setFarmerId(id); fetchReceipts(id) }}
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
              <strong>{formatKES(loanResult.disbursed_kes)}</strong> has been instantly sent to your M-Pesa wallet.
              Market value at application: {formatKES(loanResult.market_value_at_application)} ({loanResult.ltv_percent}% LTV)
            </p>
          </div>
          <CheckCircle size={24} className="loan-success-check" />
        </div>
      )}

      {/* ---- Receipts Grid ------------------------------------------------- */}
      {searched && receipts.length === 0 && !loading && (
        <div className="empty-state animate-in">
          <div className="empty-icon">📭</div>
          <p>No receipts found for farmer <strong>{farmerId.toUpperCase()}</strong></p>
          <p className="empty-sub">Visit the Warehouse Portal to log a new deposit</p>
        </div>
      )}

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

// ---- ReceiptCard sub-component ----------------------------------------------

interface ReceiptCardProps {
  receipt: EnrichedReceipt
  market: MarketPrice | null
  loanLoading: string | null
  onApplyLoan: (r: EnrichedReceipt) => void
  animDelay: number
}

function ReceiptCard({ receipt: r, market, loanLoading, onApplyLoan, animDelay }: ReceiptCardProps) {
  const currentPrice = market?.current_price ?? r.current_price_kes
  const liveValue = r.quantity_bags * currentPrice
  const liveMaxLoan = liveValue * 0.60
  const daysStored = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
  const storageCost = daysStored * r.quantity_bags * (r.holding_cost_per_bag_month / 30)

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
      {/* Card header */}
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

      {/* Financial metrics */}
      <div className="rc-metrics">
        <div className="rc-metric">
          <span className="rc-metric-label">Market Value</span>
          <span className="rc-metric-value">{formatKES(liveValue)}</span>
        </div>
        <div className="rc-metric">
          <span className="rc-metric-label">Max Loan (60% LTV)</span>
          <span className="rc-metric-value rc-metric-gold">{formatKES(liveMaxLoan)}</span>
        </div>
        <div className="rc-metric">
          <span className="rc-metric-label">Days Stored</span>
          <span className="rc-metric-value">{daysStored}d</span>
        </div>
        <div className="rc-metric">
          <span className="rc-metric-label">Storage Fee</span>
          <span className="rc-metric-value">{formatKES(storageCost)}</span>
        </div>
      </div>

      {/* Active loan details */}
      {r.active_loan && !r.active_loan.is_settled && (
        <div className="rc-loan-badge">
          <Lock size={12} />
          <span>Loan active — {formatKES(r.active_loan.principal_amount)} outstanding</span>
        </div>
      )}

      {/* CTA */}
      {r.status === 'AVAILABLE' && (
        <button
          id={`apply-loan-${r.id.substring(0, 8)}`}
          className="btn btn-gold apply-btn"
          disabled={loanLoading === r.id}
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
          Receipt locked as collateral — autonomous agent monitoring for peak price
        </div>
      )}

      {r.status === 'SETTLED' && (
        <div className="rc-settled-note">
          <CheckCircle size={13} />
          Loan cleared · Profit disbursed via M-Pesa · Warehouse space released
        </div>
      )}

      {/* Refresh button for locked receipts */}
      {r.status === 'LOCKED_COLLATERAL' && (
        <button
          className="btn btn-outline refresh-btn"
          onClick={() => {}}
          title="Status updates automatically"
        >
          <RefreshCw size={12} /> Auto-monitoring active
        </button>
      )}
    </div>
  )
}
