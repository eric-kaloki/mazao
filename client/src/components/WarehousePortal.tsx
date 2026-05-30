import React, { useState, useEffect } from 'react'
import { Warehouse, Plus, CheckCircle, Package, LayoutDashboard, BarChart3, Users, HandCoins, AlertTriangle } from 'lucide-react'
import { createReceipt, getAdminMetrics, type ProduceReceipt, type AdminMetrics, formatKES } from '../api/client'
import { useToast } from '../context/ToastContext'
import AnimatedNumber from './AnimatedNumber'
import './WarehousePortal.css'

const COMMODITIES = ['Maize', 'Wheat', 'Sorghum', 'Millet', 'Barley', 'Rice']
const GRADES = [
  'Grade 1 — Moisture <13.5%',
  'Grade 1 — Moisture <12%',
  'Grade 2 — Moisture <14%',
  'Grade 2 — Moisture <13.5%',
]

interface FormState {
  farmer_id: string
  commodity_type: string
  quantity_bags: string
  grade_info: string
}

export default function WarehousePortal() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'deposit'>('dashboard')
  
  // Deposit State
  const [form, setForm] = useState<FormState>({
    farmer_id: '',
    commodity_type: 'Maize',
    quantity_bags: '',
    grade_info: GRADES[0],
  })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<ProduceReceipt | null>(null)
  const [receipts, setReceipts] = useState<ProduceReceipt[]>([])
  
  // Metrics State
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(true)
  const { showToast } = useToast()

  const fetchMetrics = async () => {
    try {
      const data = await getAdminMetrics()
      setMetrics(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMetrics(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'dashboard') {
      fetchMetrics()
      const interval = setInterval(fetchMetrics, 10000) // Poll every 10s
      return () => clearInterval(interval)
    }
  }, [activeTab])

  const holdingCostEstimate = () => {
    const bags = parseInt(form.quantity_bags) || 0
    return bags * 10 // KES 10 per bag per month
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const bags = parseInt(form.quantity_bags)
    if (isNaN(bags) || bags < 1) {
      showToast('Quantity must be at least 1 bag', 'error')
      return
    }
    setLoading(true)

    try {
      const receipt = await createReceipt({
        farmer_id: form.farmer_id.trim().toUpperCase(),
        commodity_type: form.commodity_type,
        quantity_bags: bags,
        grade_info: form.grade_info,
      })
      setSuccess(receipt)
      showToast('Receipt Minted Successfully', 'success')
      setReceipts((prev) => [receipt, ...prev])
      setForm({ farmer_id: '', commodity_type: 'Maize', quantity_bags: '', grade_info: GRADES[0] })
      fetchMetrics() // Refresh metrics if we switch to dashboard
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'An unexpected error occurred', 'error')
    } finally {
      setLoading(false)
    }
  }

  const renderDashboard = () => {
    if (loadingMetrics && !metrics) {
      return (
        <div className="metrics-grid">
          {[1, 2, 3, 4].map(i => <div key={i} className="metric-card skeleton" style={{ height: '120px' }} />)}
        </div>
      )
    }

    if (!metrics) return null

    const ltvRatio = metrics.total_collateral_value_kes > 0 
      ? (metrics.total_loan_value_kes / metrics.total_collateral_value_kes) * 100 
      : 0

    return (
      <div className="dashboard-view animate-in">
        <div className="metrics-grid">
          <div className="metric-card glass-card">
            <div className="metric-header">
              <Users size={18} className="metric-icon" />
              <span>Registered Farmers</span>
            </div>
            <div className="metric-value"><AnimatedNumber value={metrics.total_farmers} /></div>
          </div>
          
          <div className="metric-card glass-card">
            <div className="metric-header">
              <HandCoins size={18} className="metric-icon" />
              <span>Total Disbursed</span>
            </div>
            <div className="metric-value"><AnimatedNumber value={metrics.total_disbursed} format="kes" /></div>
          </div>

          <div className="metric-card glass-card">
            <div className="metric-header">
              <BarChart3 size={18} className="metric-icon" />
              <span>Total Collateral Value</span>
            </div>
            <div className="metric-value"><AnimatedNumber value={metrics.total_collateral_value_kes} format="kes" /></div>
          </div>

          <div className="metric-card glass-card">
            <div className="metric-header">
              <AlertTriangle size={18} className="metric-icon" />
              <span>Active Loan Liability</span>
            </div>
            <div className="metric-value"><AnimatedNumber value={metrics.total_loan_value_kes} format="kes" /></div>
            <div className="metric-subtext">Across {metrics.total_active_loans} loans</div>
          </div>
        </div>

        <div className="liability-heatmap glass-card">
          <h4>System Health & Liability Overview</h4>
          <div className="progress-container">
            <div className="progress-labels">
              <span>Overall Platform LTV Ratio</span>
              <span>{ltvRatio.toFixed(1)}%</span>
            </div>
            <div className="progress-track">
              <div 
                className="progress-fill" 
                style={{ 
                  width: `${Math.min(ltvRatio, 100)}%`,
                  background: ltvRatio > 70 ? 'var(--color-danger)' : ltvRatio > 50 ? 'var(--color-warning)' : 'var(--color-success)'
                }} 
              />
            </div>
            <div className="progress-hint">
              Target LTV is &lt; 60% based on active collateral vs outstanding principal.
            </div>
          </div>
        </div>

        <h3 className="section-title" style={{ marginTop: '2rem' }}>Commodities Breakdown</h3>
        <div className="commodities-grid">
          {Object.entries(metrics.commodities).map(([commodity, data]) => (
            <div key={commodity} className="commodity-card glass-card">
              <div className="c-name">{commodity}</div>
              <div className="c-stat">
                <span className="c-label">Stored Bags</span>
                <span className="c-val"><AnimatedNumber value={data.total_bags} /></span>
              </div>
              <div className="c-stat">
                <span className="c-label">Est. Value</span>
                <span className="c-val"><AnimatedNumber value={data.total_value_kes} format="kes" /></span>
              </div>
            </div>
          ))}
          {Object.keys(metrics.commodities).length === 0 && (
             <div className="empty-state">No commodities stored yet.</div>
          )}
        </div>
      </div>
    )
  }

  const renderDepositForm = () => (
    <div className="warehouse-content animate-in">
      {/* ---- Receipt Form ------------------------------------------------ */}
      <div className="glass-card form-card">
        <div className="form-card-header">
          <Plus size={18} />
          <h3>New Deposit Entry</h3>
        </div>

        <form onSubmit={handleSubmit} id="deposit-form" className="deposit-form">
          <div className="form-group">
            <label className="form-label" htmlFor="farmer_id">Farmer ID</label>
            <input
              id="farmer_id"
              name="farmer_id"
              type="text"
              className="input-field"
              placeholder="e.g. F001"
              value={form.farmer_id}
              onChange={handleChange}
              required
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="commodity_type">Commodity</label>
            <select
              id="commodity_type"
              name="commodity_type"
              className="input-field"
              value={form.commodity_type}
              onChange={handleChange}
            >
              {COMMODITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="quantity_bags">Quantity (90kg Bags)</label>
            <input
              id="quantity_bags"
              name="quantity_bags"
              type="number"
              className="input-field"
              placeholder="e.g. 100"
              value={form.quantity_bags}
              onChange={handleChange}
              min={1}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="grade_info">Grade & Quality Assessment</label>
            <select
              id="grade_info"
              name="grade_info"
              className="input-field"
              value={form.grade_info}
              onChange={handleChange}
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {/* Cost Estimate Preview */}
          {parseInt(form.quantity_bags) > 0 && (
            <div className="cost-preview animate-in">
              <Package size={14} />
              <span>
                Estimated monthly holding cost:{' '}
                <strong>{formatKES(holdingCostEstimate())}</strong> ({form.quantity_bags} bags × KES 10)
              </span>
            </div>
          )}

          <button
            type="submit"
            id="submit-deposit"
            className="btn btn-primary submit-btn"
            disabled={loading}
          >
            {loading ? (
              <><span className="spinner" /> Minting Receipt…</>
            ) : (
              <><Plus size={16} /> Mint Digital Receipt</>
            )}
          </button>
        </form>
      </div>

      {/* ---- Right Column ------------------------------------------------ */}
      <div className="warehouse-right">
        {/* Success Banner */}
        {success && (
          <div className="success-card glass-card animate-in">
            <div className="success-icon">
              <CheckCircle size={32} />
            </div>
            <h3>Receipt Minted Successfully</h3>
            <div className="receipt-detail-grid">
              <div className="receipt-detail">
                <span className="detail-label">Receipt ID</span>
                <span className="detail-value detail-mono">{success.id.substring(0, 8).toUpperCase()}</span>
              </div>
              <div className="receipt-detail">
                <span className="detail-label">Farmer</span>
                <span className="detail-value">{success.farmer_id}</span>
              </div>
              <div className="receipt-detail">
                <span className="detail-label">Commodity</span>
                <span className="detail-value">{success.commodity_type}</span>
              </div>
              <div className="receipt-detail">
                <span className="detail-label">Quantity</span>
                <span className="detail-value">{success.quantity_bags} bags</span>
              </div>
              <div className="receipt-detail">
                <span className="detail-label">Status</span>
                <span className="badge badge-available"><span className="badge-dot" />Available</span>
              </div>
            </div>
          </div>
        )}

        {/* Session Receipts Log */}
        {receipts.length > 0 && (
          <div className="glass-card session-log animate-in">
            <h3 className="session-log-title">This Session ({receipts.length})</h3>
            <div className="session-receipts">
              {receipts.map((r) => (
                <div key={r.id} className="session-receipt-row">
                  <div className="session-receipt-info">
                    <span className="session-receipt-id">{r.id.substring(0, 8).toUpperCase()}</span>
                    <span className="session-receipt-meta">
                      {r.farmer_id} · {r.quantity_bags} bags {r.commodity_type}
                    </span>
                  </div>
                  <span className="badge badge-available"><span className="badge-dot" />Available</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="info-box glass-card">
          <h4>How it works</h4>
          <ol className="info-steps">
            <li>Grain is inspected and weighed at the cooperative warehouse node</li>
            <li>Manager inputs deposit details — a digital receipt is minted instantly</li>
            <li>Receipt status starts as <strong>AVAILABLE</strong></li>
            <li>The farmer can use this receipt as collateral for an instant M-Pesa cash advance</li>
            <li>The autonomous agent monitors market prices and settles automatically at peak</li>
          </ol>
        </div>
      </div>
    </div>
  )

  return (
    <div className="warehouse-layout">
      {/* ---- Page Header --------------------------------------------------- */}
      <div className="page-header animate-in">
        <div className="page-header-icon">
          <Warehouse size={28} />
        </div>
        <div className="header-text-tabs">
          <div>
            <h2 className="page-title">Admin Portal</h2>
            <p className="page-subtitle">
              Manage incoming logistics and monitor systemic platform health
            </p>
          </div>
          <div className="header-tabs">
            <button 
              className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <LayoutDashboard size={16} /> Dashboard
            </button>
            <button 
              className={`tab-btn ${activeTab === 'deposit' ? 'active' : ''}`}
              onClick={() => setActiveTab('deposit')}
            >
              <Plus size={16} /> Log Deposit
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'dashboard' ? renderDashboard() : renderDepositForm()}
    </div>
  )
}
