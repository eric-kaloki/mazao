import React, { useState } from 'react'
import { Warehouse, TrendingUp, Activity } from 'lucide-react'
import WarehousePortal from './components/WarehousePortal'
import FarmerDashboard from './components/FarmerDashboard'
import LiveMonitor from './components/LiveMonitor'
import './App.css'

type Tab = 'warehouse' | 'farmer' | 'monitor'

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
]

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('warehouse')

  return (
    <div className="app-layout">
      {/* ---- Header -------------------------------------------------------- */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-logo">🌽</div>
          <div>
            <h1 className="brand-name">MazaoPlus</h1>
            <p className="brand-tagline">Agri-Fintech Warehouse Receipt & Lending Platform</p>
          </div>
        </div>
        <div className="header-status">
          <span className="status-dot status-live" />
          <span className="status-label">Agent Active</span>
        </div>
      </header>

      {/* ---- Tab Navigation ----------------------------------------------- */}
      <nav className="tab-nav" role="navigation" aria-label="Main navigation">
        {TABS.map((tab) => (
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
        ))}
      </nav>

      {/* ---- Main Content -------------------------------------------------- */}
      <main className="app-main" role="main">
        {activeTab === 'warehouse' && <WarehousePortal />}
        {activeTab === 'farmer' && <FarmerDashboard />}
        {activeTab === 'monitor' && <LiveMonitor />}
      </main>

      {/* ---- Footer -------------------------------------------------------- */}
      <footer className="app-footer">
        <p>MazaoPlus &copy; 2025 — Built for Hack Day &bull; Powered by Go + React</p>
      </footer>
    </div>
  )
}
