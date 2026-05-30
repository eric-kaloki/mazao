import { useState, useEffect } from 'react'
import { Activity, Signal, AlertTriangle } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { getAllMarketPrices, createLogStream, type CommodityMarket, type AgentLogEntry } from '../api/client'
import TerminalMonitor from './TerminalMonitor'
import './LiveMonitor.css'

export default function LiveMonitor() {
  const [markets, setMarkets] = useState<CommodityMarket[]>([])
  const [selectedCommodity, setSelectedCommodity] = useState<string>('Maize')
  const [logs, setLogs] = useState<AgentLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  // Poll all markets
  useEffect(() => {
    const fetch = () => getAllMarketPrices().then(setMarkets).catch(() => {})
    fetch()
    const interval = setInterval(fetch, 3000)
    return () => clearInterval(interval)
  }, [])

  // Setup SSE for logs
  useEffect(() => {
    const eventSource = createLogStream()
    eventSource.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as AgentLogEntry
        setLogs(prev => {
          const updated = [...prev, entry]
          // Keep last 150 lines
          if (updated.length > 150) return updated.slice(updated.length - 150)
          return updated
        })
      } catch {
        // ignore malformed
      }
    }
    eventSource.onerror = () => setError('Lost connection to Autonomous Agent')
    eventSource.onopen = () => setError(null)

    return () => eventSource.close()
  }, [])

  const activeMarket = markets.find(m => m.commodity === selectedCommodity)

  const chartData = activeMarket?.price_history.map((price, i) => ({
    time: `t-${activeMarket.price_history.length - i}`,
    price,
  })) || []

  return (
    <div className="monitor-layout">
      {/* ---- Page Header --------------------------------------------------- */}
      <div className="page-header animate-in">
        <div className="page-header-icon" style={{ color: 'var(--color-green-400)' }}>
          <Activity size={28} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 className="page-title">Autonomous Market Agent</h2>
          <p className="page-subtitle">
            Real-time market simulation tracking 5 commodities. Executes smart contracts when thresholds are met.
          </p>
        </div>
      </div>

      {error && (
        <div className="form-error animate-in" style={{ borderRadius: 'var(--radius-md)' }}>
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* ---- Stats Row (Commodity Selector) -------------------------------- */}
      <div className="stats-row animate-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--space-4)' }}>
        {markets.map(mkt => {
          const isSelected = mkt.commodity === selectedCommodity
          const isAbove = mkt.current_price >= mkt.target_threshold
          return (
            <div 
              key={mkt.commodity} 
              className={`stat-card glass-card ${isSelected ? 'stat-card-active' : ''}`}
              onClick={() => setSelectedCommodity(mkt.commodity)}
              style={{ 
                cursor: 'pointer', 
                border: isSelected ? '1px solid var(--color-green-400)' : '1px solid var(--color-border-subtle)',
                background: isSelected ? 'rgba(76, 175, 80, 0.05)' : 'var(--color-bg-card)',
                transition: 'all 0.2s'
              }}
            >
              <div className="stat-label" style={{ fontWeight: isSelected ? 'bold' : 'normal' }}>{mkt.commodity}</div>
              <div className="stat-value" style={{ color: isAbove ? 'var(--color-gold-400)' : 'var(--color-text-primary)' }}>
                <span className="stat-currency">KES</span>
                {mkt.current_price.toFixed(0)}
              </div>
              <div className="stat-meta" style={{ color: isAbove ? 'var(--color-gold-400)' : 'var(--color-text-muted)' }}>
                {isAbove ? '⚡ THRESHOLD REACHED' : `${Math.abs(mkt.current_price - mkt.target_threshold).toFixed(0)} to threshold`}
              </div>
            </div>
          )
        })}
      </div>

      <div className="monitor-split">
        {/* ---- Live Chart -------------------------------------------------- */}
        <div className="chart-panel glass-card animate-in">
          <div className="panel-header">
            <h3><Signal size={18} /> {selectedCommodity} Spot Price (KES/bag)</h3>
            <span className="live-indicator">
              <span className="live-dot" /> LIVE
            </span>
          </div>

          <div className="chart-container">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4CAF50" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4CAF50" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="time" stroke="#666" fontSize={11} tickMargin={10} minTickGap={30} />
                <YAxis
                  domain={[activeMarket?.price_min ?? 0, activeMarket?.price_max ?? 10000]}
                  stroke="#666"
                  fontSize={11}
                  tickFormatter={(val) => `KES ${val}`}
                  width={80}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a1e', border: '1px solid #333', borderRadius: '8px' }}
                  itemStyle={{ color: '#4CAF50', fontWeight: 'bold' }}
                />
                <ReferenceLine
                  y={activeMarket?.target_threshold ?? 0}
                  stroke="#F9A825"
                  strokeDasharray="4 4"
                  label={{ position: 'top', value: 'Settlement Threshold', fill: '#F9A825', fontSize: 11 }}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#4CAF50"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorPrice)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ---- Terminal ---------------------------------------------------- */}
        <TerminalMonitor logs={logs} />
      </div>
    </div>
  )
}
