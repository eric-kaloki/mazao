import { useState } from 'react'
import { Shield, TrendingUp, AlertCircle, Coins, Gift } from 'lucide-react'
import { useFarmer } from '../context/FarmerContext'
import { applyInputLoan, formatKES } from '../api/client'
import './CreditScore.css'

export default function CreditScore() {
  const { farmer, refreshFarmer } = useFarmer()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!farmer) return null

  const getScoreColor = (score: number) => {
    if (score >= 800) return 'var(--color-gold-400)' // Platinum/Gold visually
    if (score >= 600) return 'var(--color-gold-600)'
    if (score >= 400) return '#A0AEC0' // Silver
    return '#CD7F32' // Bronze
  }

  const scoreColor = getScoreColor(farmer.credit_score)
  const rotation = (farmer.credit_score / 1000) * 180 - 90 // -90 to 90 degrees

  const handleApplyInputLoan = async () => {
    if (farmer.credit_band === 'BRONZE') return
    setLoading(true)
    setError(null)
    setSuccess(null)
    
    // Auto-calculate requested amount based on band
    let amount = 0
    if (farmer.credit_band === 'PLATINUM') amount = 100000
    else if (farmer.credit_band === 'GOLD') amount = 50000
    else if (farmer.credit_band === 'SILVER') amount = 10000

    try {
      const res = await applyInputLoan({
        farmer_id: farmer.national_id,
        loan_type: 'INPUT_LOAN',
        amount_kes: amount,
        description: 'Season Input Finance'
      })
      setSuccess(`Success! Disbursed ${formatKES(res.disbursed_kes)} to M-Pesa.`)
      refreshFarmer()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Application failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="credit-score-panel glass-card animate-in">
      <div className="cs-header">
        <Shield size={20} color={scoreColor} />
        <h3>Kilimo Credit Profile</h3>
      </div>

      <div className="cs-gauge-container">
        <div className="cs-gauge">
          <svg viewBox="0 0 100 50" className="gauge-svg">
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke={scoreColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="125.6" /* Pi * 40 */
              strokeDashoffset={125.6 * (1 - (farmer.credit_score / 1000))}
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="gauge-needle" style={{ transform: `rotate(${rotation}deg)` }}>
            <div className="needle-base" />
          </div>
        </div>
        <div className="cs-score-text">
          <span className="cs-score-value" style={{ color: scoreColor }}>{farmer.credit_score}</span>
          <span className="cs-score-max">/ 1000</span>
        </div>
        <div className="cs-band-badge" style={{ borderColor: scoreColor, color: scoreColor }}>
          {farmer.credit_band} TIER
        </div>
      </div>

      <div className="cs-stats">
        <div className="cs-stat">
          <span className="stat-label">Loans Settled</span>
          <span className="stat-value">{farmer.loans_settled}</span>
        </div>
        <div className="cs-stat">
          <span className="stat-label">Total Disbursed</span>
          <span className="stat-value">{formatKES(farmer.total_disbursed)}</span>
        </div>
      </div>

      <div className="cs-products">
        <h4>Available Financial Products</h4>
        <ul className="product-list">
          <li className="product-item unlocked">
            <Coins size={16} />
            <span>Warehouse Receipt Loans (60% LTV)</span>
          </li>
          
          <li className={`product-item ${farmer.credit_score >= 400 ? 'unlocked' : 'locked'}`}>
            <TrendingUp size={16} />
            <span>
              Input Finance Advance 
              {farmer.credit_score >= 400 ? ' (Up to KES 20K)' : ' (Unlocks at Silver)'}
            </span>
          </li>

          <li className={`product-item ${farmer.credit_score >= 600 ? 'unlocked' : 'locked'}`}>
            <Gift size={16} />
            <span>
              Pre-Harvest Yield Loan 
              {farmer.credit_score >= 600 ? ' (Up to KES 50K)' : ' (Unlocks at Gold)'}
            </span>
          </li>
        </ul>
      </div>

      {farmer.credit_score >= 400 && (
        <div className="cs-action">
          {error && <div className="form-error mb-2"><AlertCircle size={14}/> {error}</div>}
          {success && <div className="form-success mb-2">{success}</div>}
          <button 
            className="btn btn-outline apply-input-btn" 
            onClick={handleApplyInputLoan}
            disabled={loading}
          >
            {loading ? <span className="spinner"/> : 'Apply for Input Finance'}
          </button>
        </div>
      )}
    </div>
  )
}
