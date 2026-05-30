import React, { useState } from 'react'
import { User, LogIn, AlertCircle } from 'lucide-react'
import { loginFarmer } from '../api/client'
import { useFarmer } from '../context/FarmerContext'
import './LoginScreen.css'

export default function LoginScreen() {
  const { setFarmer } = useFarmer()
  const [nationalId, setNationalId] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nationalId.trim()) return

    setLoading(true)
    setError(null)

    try {
      // loginFarmer upserts the farmer profile.
      const farmerData = await loginFarmer(nationalId, fullName, phone)
      setFarmer(farmerData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
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

          {error && (
            <div className="form-error">
              <AlertCircle size={15} />
              {error}
            </div>
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
