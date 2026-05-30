import React, { useState } from 'react'
import { Warehouse, TrendingUp, Activity, Smartphone, LogOut } from 'lucide-react'
import WarehousePortal from './components/WarehousePortal'
import FarmerDashboard from './components/FarmerDashboard'
import LiveMonitor from './components/LiveMonitor'
import USSDSimulator from './components/USSDSimulator'
import LoginScreen from './components/LoginScreen'
import { FarmerProvider, useFarmer } from './context/FarmerContext'
import './App.css'

type Tab = 'warehouse' | 'farmer' | 'monitor' | 'ussd'

const TABS: { id: Tab; label: string; icon: React.ReactNode; description: string }[] = [
  {
    id: 'warehouse',
    label: 'Warehouse Portal',
    icon: <Warehouse size={18} />,
    description: 'Log cereal deposits & mint digital receipts',
  },
  {
    id: 'farmer',
    label: 'Farmer Dashboard',
    icon: <TrendingUp size={18} />,
    description: 'View receipts & apply for M-Pesa micro-loans',
  },
  {
    id: 'monitor',
    label: 'Live Monitor',
    icon: <Activity size={18} />,
    description: 'Real-time market prices & agent activity',
  },
  {
    id: 'ussd',
    label: 'USSD Simulator',
    icon: <Smartphone size={18} />,
    description: 'Feature phone access for offline farmers',
  },
]

function AppContent() {
  const [role, setRole] = useState<'none' | 'farmer' | 'manager'>('none')
  const [activeTab, setActiveTab] = useState<Tab>('farmer')
  const { farmer, setFarmer } = useFarmer()

  // Auto-switch tabs based on role
  React.useEffect(() => {
    if (role === 'manager') setActiveTab('warehouse')
    if (role === 'farmer') setActiveTab('farmer')
  }, [role])

  if (role === 'none') {
    return (
      <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--color-bg)' }}>
        <div className="glass-card" style={{ padding: 'var(--space-8)', textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-4)' }}>🌽</div>
          <h1 style={{ marginBottom: 'var(--space-2)' }}>MazaoPlus</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-8)' }}>Select your role to continue</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <button className="btn btn-primary" onClick={() => setRole('farmer')} style={{ padding: 'var(--space-4)' }}>
              I am a Farmer
            </button>
            <button className="btn btn-outline" onClick={() => setRole('manager')} style={{ padding: 'var(--space-4)' }}>
              I am a Warehouse Manager
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      {/* Show login overlay if farmer role but not authenticated */}
      {role === 'farmer' && !farmer && <LoginScreen onBack={() => setRole('none')} />}

      {/* ---- Header -------------------------------------------------------- */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-logo">🌽</div>
          <div>
            <h1 className="brand-name">MazaoPlus</h1>
            <p className="brand-tagline">Agri-Fintech Warehouse Receipt & Lending Platform</p>
          </div>
        </div>
        
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          {role === 'manager' && (
            <div className="header-farmer" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontWeight: 'bold', color: 'var(--color-gold-400)' }}>Warehouse Manager</span>
              <button onClick={() => setRole('none')} className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.7rem' }}>
                <LogOut size={12} />
              </button>
            </div>
          )}
          {role === 'farmer' && farmer && (
            <div className="header-farmer" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Logged in as:</span>
              <span style={{ fontWeight: 'bold', color: 'var(--color-gold-400)' }}>{farmer.full_name}</span>
              <button 
                onClick={() => { setFarmer(null); setRole('none'); }} 
                className="btn btn-outline" 
                style={{ padding: '4px 8px', height: 'auto', fontSize: '0.7rem' }}
                title="Logout"
              >
                <LogOut size={12} />
              </button>
            </div>
          )}
          <div className="header-status">
            <span className="status-dot status-live" />
            <span className="status-label">Agent Active</span>
          </div>
        </div>
      </header>

      {/* ---- Tab Navigation ----------------------------------------------- */}
      <nav className="tab-nav" role="navigation" aria-label="Main navigation">
        {TABS.map((tab) => {
          if (role === 'farmer' && tab.id === 'warehouse') return null;
          if (role === 'manager' && tab.id === 'farmer') return null;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              className={`tab-btn ${activeTab === tab.id ? 'tab-btn--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.icon}
              <span className="tab-label">{tab.label}</span>
              <span className="tab-description">{tab.description}</span>
            </button>
          )
        })}
      </nav>

      {/* ---- Main Content -------------------------------------------------- */}
      <main className="app-main" role="main">
        {activeTab === 'warehouse' && <WarehousePortal />}
        {activeTab === 'farmer' && <FarmerDashboard />}
        {activeTab === 'monitor' && <LiveMonitor />}
        {activeTab === 'ussd' && <USSDSimulator />}
      </main>

      {/* ---- Footer -------------------------------------------------------- */}
      <footer className="app-footer">
        <p>MazaoPlus &copy; 2025 — Built for Hack Day &bull; Go + React &bull; USSD for every farmer</p>
      </footer>
    </div>
  )
}

import { ToastProvider } from './context/ToastContext'

export default function App() {
  return (
    <ToastProvider>
      <FarmerProvider>
        <AppContent />
      </FarmerProvider>
    </ToastProvider>
  )
}
