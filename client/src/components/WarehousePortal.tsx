import React, { useState } from 'react'
import { Warehouse, Plus, CheckCircle, AlertCircle, Package } from 'lucide-react'
import { createReceipt, type ProduceReceipt, formatKES } from '../api/client'
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
  const [form, setForm] = useState<FormState>({
    farmer_id: '',
    commodity_type: 'Maize',
    quantity_bags: '',
    grade_info: GRADES[0],
  })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<ProduceReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receipts, setReceipts] = useState<ProduceReceipt[]>([])

  const holdingCostEstimate = () => {
    const bags = parseInt(form.quantity_bags) || 0
    return bags * 10 // KES 10 per bag per month
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const bags = parseInt(form.quantity_bags)
    if (isNaN(bags) || bags < 1) {
      setError('Quantity must be at least 1 bag')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const receipt = await createReceipt({
        farmer_id: form.farmer_id.trim().toUpperCase(),
        commodity_type: form.commodity_type,
        quantity_bags: bags,
        grade_info: form.grade_info,
      })
      setSuccess(receipt)
      setReceipts((prev) => [receipt, ...prev])
      setForm({ farmer_id: '', commodity_type: 'Maize', quantity_bags: '', grade_info: GRADES[0] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="warehouse-layout">
      {/* ---- Page Header --------------------------------------------------- */}
      <div className="page-header animate-in">
        <div className="page-header-icon">
          <Warehouse size={28} />
        </div>
        <div>
          <h2 className="page-title">Warehouse Portal</h2>
          <p className="page-subtitle">
            Log incoming grain deposits and mint digital produce receipts on the blockchain ledger
          </p>
        </div>
      </div>

      <div className="warehouse-content">
        {/* ---- Receipt Form ------------------------------------------------ */}
        <div className="glass-card form-card animate-in">
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

            {error && (
              <div className="form-error animate-in">
                <AlertCircle size={15} />
                {error}
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
    </div>
  )
}
