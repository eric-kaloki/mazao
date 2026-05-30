import React, { useState } from 'react'
import { User, LogIn } from 'lucide-react'
import { loginFarmer } from '../api/client'
import { useFarmer } from '../context/FarmerContext'
import { useToast } from '../context/ToastContext'
import './LoginScreen.css'

interface Props {
  onBack?: () => void
}

export default function LoginScreen({ onBack }: Props) {
  const { setFarmer } = useFarmer()
  const { showToast } = useToast()
  const [nationalId, setNationalId] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nationalId.trim()) return

    setLoading(true)

    try {
      // loginFarmer upserts the farmer profile.
      const farmerData = await loginFarmer(nationalId, fullName, phone)
      setFarmer(farmerData)
      showToast(`Welcome, ${farmerData.full_name}`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Login failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDemoLogin = (id: string) => {
    setNationalId(id)
    setIsRegistering(false)
    setFullName('')
    setPhone('')
  }

  return (
    <div className="login-overlay">
      <div className="login-card glass-card animate-in">
        <div className="login-header">
          <div className="login-icon">
            <User size={32} />
          </div>
          <h2>Farmer Portal</h2>
          <p>Login with your National ID</p>
        </div>
        
        {onBack && (
          <button type="button" className="btn btn-link" onClick={onBack} style={{ marginBottom: 'var(--space-4)', alignSelf: 'flex-start' }}>
            &larr; Back to Role Selection
          </button>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="nationalId">National ID</label>
            <input
              id="nationalId"
              type="text"
              className="input-field"
              placeholder="e.g. 12345678"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value.replace(/[^0-9A-Z]/gi, ''))}
              required
            />
          </div>

          {isRegistering && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="fullName">Full Name (Optional)</label>
                <input
                  id="fullName"
                  type="text"
                  className="input-field"
                  placeholder="e.g. Wanjiku Kamau"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="phone">Phone Number (Optional)</label>
                <input
                  id="phone"
                  type="tel"
                  className="input-field"
                  placeholder="e.g. +254712345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </>
          )}

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? <span className="spinner" /> : <LogIn size={18} />}
            {loading ? 'Authenticating...' : 'Enter Portal'}
          </button>

          <div className="login-toggle">
            <button
              type="button"
              className="btn btn-link"
              onClick={() => setIsRegistering(!isRegistering)}
            >
              {isRegistering ? 'Just login with ID' : 'Register new profile'}
            </button>
          </div>
        </form>

        <div className="login-demo">
          <p className="demo-label">Demo Accounts:</p>
          <div className="demo-chips">
            <button type="button" className="demo-chip" onClick={() => handleDemoLogin('12345678')}>Gold Tier</button>
            <button type="button" className="demo-chip" onClick={() => handleDemoLogin('87654321')}>Silver Tier</button>
            <button type="button" className="demo-chip" onClick={() => handleDemoLogin('11223344')}>Bronze Tier</button>
          </div>
        </div>
      </div>
    </div>
  )
}
