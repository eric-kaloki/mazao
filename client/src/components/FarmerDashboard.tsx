import { useState, useEffect, useCallback, useRef } from 'react'
import { User, Wallet, Lock, CheckCircle, RefreshCw, HandCoins, Settings2 } from 'lucide-react'
import {
  getFarmerReceipts,
  manualSellReceipt,
  setTargetPrice,
  applyForLoan,
  type EnrichedReceipt,
  type SettlementResult,
  formatKES,
} from '../api/client'
import { useFarmer } from '../context/FarmerContext'
import { useToast } from '../context/ToastContext'
import CreditScore from './CreditScore'
import AnimatedNumber from './AnimatedNumber'
import './FarmerDashboard.css'

export default function FarmerDashboard() {
  const { farmer, refreshFarmer } = useFarmer()
  const [receipts, setReceipts] = useState<EnrichedReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const { showToast } = useToast()
  const [settlementResult, setSettlementResult] = useState<SettlementResult | null>(null)
  const currentFarmerRef = useRef(farmer?.national_id || '')

  useEffect(() => {
    currentFarmerRef.current = farmer?.national_id || ''
    if (farmer) {
      fetchReceipts(farmer.national_id)
    }
  }, [farmer])

  const fetchReceipts = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await getFarmerReceipts(id)
      setReceipts(data.receipts)
    } catch (err) {
      if (!silent) {
        showToast(err instanceof Error ? err.message : 'Failed to fetch receipts', 'error')
        setReceipts([])
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Auto-refresh every 5s when at least one receipt is LOCKED_COLLATERAL
  useEffect(() => {
    const hasLocked = receipts.some(r => r.status === 'LOCKED_COLLATERAL')
    if (!hasLocked || !currentFarmerRef.current) return
    const interval = setInterval(() => {
      fetchReceipts(currentFarmerRef.current, true /* silent */)
      refreshFarmer() // also refresh wallet/credit score
    }, 5000)
    return () => clearInterval(interval)
  }, [receipts, fetchReceipts, refreshFarmer])

  const handleManualSell = async (receipt: EnrichedReceipt) => {
    if (actionLoading) return
    if (!confirm(`Are you sure you want to sell ${receipt.quantity_bags} bags of ${receipt.commodity_type} at the current market price?`)) return
    
    setActionLoading(receipt.id)
    
    const previousReceipts = [...receipts]
    // Optimistic update: instantly remove or mark as settled
    setReceipts(prev => prev.map(r => r.id === receipt.id ? { ...r, status: 'SETTLED' } : r))

    try {
      const result = await manualSellReceipt(receipt.id, farmer!.national_id)
      setSettlementResult(result)
      showToast('Sale successful', 'success')
      await fetchReceipts(farmer!.national_id, true)
      await refreshFarmer()
    } catch (err) {
      setReceipts(previousReceipts)
      showToast(err instanceof Error ? err.message : 'Manual sell failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleSetTargetPrice = async (receipt: EnrichedReceipt, target: number | null) => {
    if (actionLoading) return
    setActionLoading(receipt.id)
    
    const previousReceipts = [...receipts]
    // Optimistic update
    setReceipts(prev => prev.map(r => r.id === receipt.id ? { ...r, target_sell_price: target ?? undefined } : r))

    try {
      await setTargetPrice(receipt.id, farmer!.national_id, target)
      showToast(target ? `Smart Sell set to KES ${target}` : 'Smart Sell disabled', 'success')
      // Background sync to ensure correctness
      fetchReceipts(farmer!.national_id, true)
    } catch (err) {
      setReceipts(previousReceipts)
      showToast(err instanceof Error ? err.message : 'Failed to set target price', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleApplyLoan = async (receipt: EnrichedReceipt, requestedAmount: number) => {
    if (actionLoading) return
    setActionLoading(receipt.id)

    const previousReceipts = [...receipts]
    // Optimistic update: fake the loan to update UI instantly
    setReceipts(prev => prev.map(r => r.id === receipt.id ? { 
      ...r, 
      status: 'LOCKED_COLLATERAL',
      active_loan: { id: 'temp', farmer_id: r.farmer_id, principal_amount: requestedAmount, interest_rate: 0.12, status: 'ACTIVE', created_at: new Date().toISOString(), loan_type: 'RECEIPT_BACKED', is_settled: false }
    } : r))

    try {
      await applyForLoan({ receipt_id: receipt.id, farmer_id: farmer!.national_id, requested_amount: requestedAmount })
      showToast(`Loan of KES ${requestedAmount} approved & disbursed!`, 'success')
      await fetchReceipts(farmer!.national_id, true)
      await refreshFarmer()
    } catch (err) {
      setReceipts(previousReceipts)
      showToast(err instanceof Error ? err.message : 'Failed to apply for loan', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const hasLocked = receipts.some(r => r.status === 'LOCKED_COLLATERAL')

  if (!farmer) return null

  return (
    <div className="farmer-layout">
      {/* ---- Farmer Profile Header ----------------------------------------- */}
      <div className="profile-header glass-card animate-in">
        <div className="profile-info">
          <div className="profile-avatar">
            <User size={32} />
          </div>
          <div>
            <h2 className="profile-name">{farmer.full_name}</h2>
            <div className="profile-meta">
              <span>ID: {farmer.national_id}</span>
              <span>•</span>
              <span>{farmer.phone_number}</span>
            </div>
          </div>
        </div>
        <div className="profile-wallet">
          <div className="wallet-label">
            <Wallet size={16} /> Wallet Balance
          </div>
          <div className="wallet-amount"><AnimatedNumber value={farmer.wallet_balance} format="kes" /></div>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Left Column: Receipts */}
        <div className="receipts-column">
          <div className="column-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '32px' }}>
            <h3 style={{ margin: 0 }}>My Receipts</h3>
            <div 
              className="auto-refresh-badge" 
              style={{ visibility: hasLocked ? 'visible' : 'hidden' }}
            >
              <RefreshCw size={12} className="spin-slow" /> Auto-refreshing
            </div>
          </div>

          {/* ---- Settlement Breakdown Modal (inline for Hack Day) ------------- */}
          {settlementResult && (
            <div className="settlement-success glass-card animate-in">
              <div className="ss-header">
                <CheckCircle size={24} className="ss-icon" />
                <h3>Settlement Successful</h3>
                <button className="btn btn-link" onClick={() => setSettlementResult(null)}>✕</button>
              </div>
              <div className="ss-ledger">
                <div className="ss-row">
                  <span>Gross Revenue (KES {settlementResult.sale_price}/bag)</span>
                  <span>{formatKES(settlementResult.gross_revenue)}</span>
                </div>
                {settlementResult.principal > 0 && (
                  <div className="ss-row ss-deduction">
                    <span>- Loan Principal</span>
                    <span>{formatKES(settlementResult.principal)}</span>
                  </div>
                )}
                {settlementResult.interest > 0 && (
                  <div className="ss-row ss-deduction">
                    <span>- Interest Accrued</span>
                    <span>{formatKES(settlementResult.interest)}</span>
                  </div>
                )}
                <div className="ss-row ss-deduction">
                  <span>- Storage Fees ({settlementResult.days_elapsed} days)</span>
                  <span>{formatKES(settlementResult.storage_fee)}</span>
                </div>
                <div className="ss-row ss-deduction">
                  <span>- Platform Fee (1%)</span>
                  <span>{formatKES(settlementResult.platform_fee)}</span>
                </div>
                <div className="ss-row ss-net">
                  <span>Net Profit Disbursed</span>
                  <span className="ss-net-value">{formatKES(settlementResult.net_profit)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ---- Receipts Grid ------------------------------------------------- */}
          {receipts.length === 0 && !loading && (
            <div className="empty-state animate-in">
              <div className="empty-icon">📭</div>
              <p>No active receipts found.</p>
              <p className="empty-sub">Visit the Warehouse Portal to log a new deposit</p>
            </div>
          )}

          <div className="receipts-list">
            {loading && receipts.length === 0 && (
              <>
                <div className="receipt-card glass-card skeleton-card animate-in" style={{ height: '280px', opacity: 0.7 }} />
                <div className="receipt-card glass-card skeleton-card animate-in" style={{ height: '280px', opacity: 0.5, animationDelay: '100ms' }} />
              </>
            )}
            {!loading && receipts.length > 0 && receipts.map((r, i) => (
              <ReceiptCard
                key={r.id}
                receipt={r}
                actionLoading={actionLoading}
                onManualSell={handleManualSell}
                onSetTargetPrice={handleSetTargetPrice}
                onApplyLoan={handleApplyLoan}
                animDelay={i * 80}
              />
            ))}
          </div>

          <div className="disclaimer-note" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255, 255, 255, 0.05)', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            <strong style={{ color: 'var(--color-gold-400)' }}>Important:</strong> Market sales are settled and disbursed within 24-48 hours. Loan disbursements to your M-Pesa account happen immediately upon approval.
          </div>
        </div>

        {/* Right Column: Credit Score & Products */}
        <div className="credit-column">
          <CreditScore />
        </div>
      </div>
    </div>
  )
}

// ---- ReceiptCard -------------------------------------------------------------

interface ReceiptCardProps {
  receipt: EnrichedReceipt
  actionLoading: string | null
  onManualSell: (r: EnrichedReceipt) => void
  onSetTargetPrice: (r: EnrichedReceipt, target: number | null) => void
  onApplyLoan: (r: EnrichedReceipt, amount: number) => void
  animDelay: number
}

function ReceiptCard({ receipt: r, actionLoading, onManualSell, onSetTargetPrice, onApplyLoan, animDelay }: ReceiptCardProps) {
  const [loanAmountStr, setLoanAmountStr] = useState('')
  const [targetPriceStr, setTargetPriceStr] = useState('')
  const [showTargetForm, setShowTargetForm] = useState(false)

  // Storage fee: accrued from created_at to now
  const daysStored = Math.max(0, (Date.now() - new Date(r.created_at).getTime()) / 86400000)
  const storageFee = daysStored * r.quantity_bags * (r.holding_cost_per_bag_month / 30)

  // Debt calc
  let totalDebt = storageFee
  if (r.active_loan) {
    const interest = r.active_loan.principal_amount * r.active_loan.interest_rate * (daysStored / 365)
    totalDebt += r.active_loan.principal_amount + interest
  }
  
  const platformFee = r.current_market_value_kes * 0.01
  totalDebt += platformFee

  const netProfit = Math.max(0, r.current_market_value_kes - totalDebt)

  // For AVAILABLE receipts: loan ceiling is based on deposit price (frozen), not live
  const depositBasedMaxLoan = r.deposit_value_kes * 0.60

  const statusBadge = {
    AVAILABLE:         { label: 'Available',   cls: 'badge-available' },
    LOCKED_COLLATERAL: { label: 'Locked',       cls: 'badge-locked' },
    SETTLED:           { label: 'Settled',      cls: 'badge-settled' },
  }[r.status]

  const handleLoanSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const amt = parseFloat(loanAmountStr)
    if (amt > 0 && amt <= depositBasedMaxLoan) {
      onApplyLoan(r, amt)
    }
  }

  const handleTargetSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (targetPriceStr.trim() === '') {
      onSetTargetPrice(r, null)
      setShowTargetForm(false)
      return
    }
    const val = parseFloat(targetPriceStr)
    if (val > 0) {
      onSetTargetPrice(r, val)
      setShowTargetForm(false)
    }
  }

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

      {/* Financial metrics */}
      {r.status === 'AVAILABLE' && (
        <>
          <div className="rc-metrics">
            <div className="rc-metric">
              <span className="rc-metric-label">Entry Price</span>
              <span className="rc-metric-value">{formatKES(r.price_at_deposit)}/bag</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Live Market Value</span>
              <span className="rc-metric-value rc-metric-live">{formatKES(r.current_market_value_kes)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Max Loan (60% of entry)</span>
              <span className="rc-metric-value rc-metric-gold">{formatKES(depositBasedMaxLoan)}</span>
            </div>
          </div>
          <form onSubmit={handleLoanSubmit} className="rc-loan-form" style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
            <input
              type="number"
              placeholder={`Amount (Max: ${depositBasedMaxLoan})`}
              className="input-field"
              value={loanAmountStr}
              onChange={(e) => setLoanAmountStr(e.target.value)}
              max={depositBasedMaxLoan}
              min={1}
              style={{ flex: 1 }}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={actionLoading === r.id}>
              {actionLoading === r.id ? <span className="spinner" /> : 'Apply Loan'}
            </button>
          </form>
        </>
      )}

      {r.status === 'LOCKED_COLLATERAL' && r.active_loan && (
        <>
          <div className="rc-metrics">
            <div className="rc-metric">
              <span className="rc-metric-label">Loan Issued</span>
              <span className="rc-metric-value rc-metric-gold">{formatKES(r.active_loan.principal_amount)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Total Est. Debt</span>
              <span className="rc-metric-value" style={{ color: '#F56565' }}>{formatKES(totalDebt)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Current Market Value</span>
              <span className="rc-metric-value rc-metric-live">{formatKES(r.current_market_value_kes)}</span>
            </div>
            <div className="rc-metric">
              <span className="rc-metric-label">Est. Net Profit</span>
              <span className="rc-metric-value rc-metric-live">{formatKES(netProfit)}</span>
            </div>
          </div>
          
          <div className="rc-actions-row">
            <button
              className="btn btn-outline rc-sell-btn"
              disabled={actionLoading !== null}
              onClick={() => onManualSell(r)}
            >
              {actionLoading === r.id ? <span className="spinner" /> : <HandCoins size={14} />}
              Sell Now
            </button>
            
            <button
              className={`btn ${r.target_sell_price ? 'btn-gold' : 'btn-outline'} rc-toggle-btn`}
              disabled={actionLoading !== null}
              onClick={() => setShowTargetForm(!showTargetForm)}
            >
              <Settings2 size={14} />
              {r.target_sell_price ? 'Smart Sell ON' : 'Set Smart Sell'}
            </button>
          </div>

          {showTargetForm && (
            <form onSubmit={handleTargetSubmit} style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
              <input
                type="number"
                placeholder="Target price per bag (or empty to clear)"
                className="input-field"
                value={targetPriceStr}
                onChange={(e) => setTargetPriceStr(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary" disabled={actionLoading === r.id}>Save</button>
            </form>
          )}
          
          {!showTargetForm && r.target_sell_price && (
            <div className="rc-locked-note">
              <Lock size={13} />
              Agent will auto-sell when market hits KES {r.target_sell_price}.
            </div>
          )}
          {!showTargetForm && !r.target_sell_price && (
            <div className="rc-locked-note" style={{ background: 'rgba(245, 101, 101, 0.1)', borderColor: 'rgba(245, 101, 101, 0.2)', color: '#FC8181' }}>
              <Lock size={13} />
              No target price set. You must sell manually.
            </div>
          )}
        </>
      )}

      {r.status === 'SETTLED' && (
        <div className="rc-settled-note">
          <CheckCircle size={13} />
          Loan cleared · Net profit disbursed via M-Pesa
        </div>
      )}
    </div>
  )
}



