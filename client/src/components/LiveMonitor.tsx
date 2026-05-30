import { useState, useEffect } from 'react'
import { Activity, TrendingUp, TrendingDown } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { getMarketStatus, createLogStream, type MarketPrice, type AgentLogEntry, formatKES } from '../api/client'
import TerminalMonitor from './TerminalMonitor'
import './LiveMonitor.css'

interface PriceTick {
  tick: number
  price: number
  label: string
}

export default function LiveMonitor() {
  const [market, setMarket] = useState<MarketPrice | null>(null)
  const [chartData, setChartData] = useState<PriceTick[]>([])
  const [tickCount, setTickCount] = useState(0)
  const [prevPrice, setPrevPrice] = useState<number | null>(null)
  const [logs, setLogs] = useState<AgentLogEntry[]>([])
  const [settled, setSettled] = useState(0)

  // Poll market status every 2 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getMarketStatus()
        setMarket((prev) => {
          if (prev) setPrevPrice(prev.current_price)
          return data
        })

        // Build chart data from price history returned by the backend
        if (data.price_history && data.price_history.length > 0) {
          const ticks: PriceTick[] = data.price_history.map((p, i) => ({
            tick: i + 1,
            price: p,
            label: `Day ${i + 1}`,
          }))
          setChartData(ticks)
          setTickCount(ticks.length)
        }
      } catch {
        // Silent fail — backend may not be up yet
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [])

  // SSE log stream
  useEffect(() => {
    const es = createLogStream()
    es.onmessage = (event) => {
      try {
        const entry: AgentLogEntry = JSON.parse(event.data)
        setLogs((prev) => {
          const updated = [...prev, entry]
          // Count settlement events for the stats bar
          if (entry.level === 'PAYOUT' && entry.message.includes('Settlement complete')) {
            setSettled((s) => s + 1)
          }
          return updated.slice(-200) // keep last 200 entries in memory
        })
      } catch {
        // Malformed message — ignore
      }
    }
    return () => es.close()
  }, [])

  const price = market?.current_price ?? 0
  const threshold = market?.target_threshold ?? 3500
  const aboveThreshold = price >= threshold
  const priceDirection = prevPrice !== null ? (price >= prevPrice ? 'up' : 'down') : 'up'

  // Custom tooltip for recharts
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const val = payload[0].value as number
      const isAbove = val >= threshold
      return (
        <div className="chart-tooltip">
          <div className="tooltip-price" style={{ color: isAbove ? 'var(--color-gold-700)' : 'var(--color-green-400)' }}>
            {formatKES(val)}
          </div>
          <div className="tooltip-label">{payload[0].payload.label}</div>
          {isAbove && <div className="tooltip-threshold-badge">⚡ Above Threshold</div>}
        </div>
      )
    }
    return null
  }

  return (
    <div className="monitor-layout">
      {/* ---- Page Header --------------------------------------------------- */}
      <div className="page-header animate-in">
        <div className="page-header-icon">
          <Activity size={28} />
        </div>
        <div>
          <h2 className="page-title">Live Market Monitor</h2>
          <p className="page-subtitle">
            Real-time Maize price index · Autonomous agent activity stream · Settlement log
          </p>
        </div>
      </div>

      {/* ---- Stats Row ----------------------------------------------------- */}
      <div className="stats-row animate-in">
        <div className="stat-card glass-card">
          <div className="stat-icon" style={{ color: aboveThreshold ? 'var(--color-gold-700)' : 'var(--color-green-400)' }}>
            {priceDirection === 'up' ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
          </div>
          <div className="stat-body">
            <div className="stat-label">Current Spot Price</div>
            <div className={`stat-value ${aboveThreshold ? 'stat-value--gold' : ''}`}>
              {price > 0 ? formatKES(price) : '—'}
            </div>
          </div>
        </div>

        <div className="stat-card glass-card">
          <div className="stat-icon" style={{ color: 'var(--color-gold-800)' }}>⚡</div>
          <div className="stat-body">
            <div className="stat-label">Settlement Threshold</div>
            <div className="stat-value stat-value--gold">{formatKES(threshold)}</div>
          </div>
        </div>

        <div className="stat-card glass-card">
          <div className="stat-icon" style={{ color: 'var(--color-text-muted)' }}>📅</div>
          <div className="stat-body">
            <div className="stat-label">Market Days Simulated</div>
            <div className="stat-value">{tickCount}</div>
          </div>
        </div>

        <div className="stat-card glass-card">
          <div className="stat-icon" style={{ color: 'var(--color-payout)' }}>💸</div>
          <div className="stat-body">
            <div className="stat-label">Settlements Executed</div>
            <div className="stat-value stat-value--cyan">{settled}</div>
          </div>
        </div>
      </div>

      {/* ---- Chart + Terminal Split ---------------------------------------- */}
      <div className="monitor-split">
        {/* Price Chart */}
        <div className="chart-panel glass-card animate-in">
          <div className="panel-header">
            <div className="panel-header-left">
              <div className={`chart-indicator ${aboveThreshold ? 'chart-indicator--active' : ''}`} />
              <h3>Maize Spot Price — Live Index</h3>
            </div>
            {aboveThreshold && (
              <div className="threshold-alert">⚡ ABOVE THRESHOLD — AGENT EXECUTING</div>
            )}
          </div>

          <div className="chart-container">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#43a047" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#43a047" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,58,34,0.6)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#558b5a', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#1e3a22' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[2200, 4700]}
                    tick={{ fill: '#558b5a', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                    width={40}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {/* Settlement threshold reference line */}
                  <ReferenceLine
                    y={threshold}
                    stroke="#fbc02d"
                    strokeDasharray="6 3"
                    strokeWidth={1.5}
                    label={{
                      value: '⚡ Settlement',
                      position: 'insideTopRight',
                      fill: '#fbc02d',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke="#4caf50"
                    strokeWidth={2}
                    fill="url(#priceGradient)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#fbc02d', strokeWidth: 0 }}
                    animationDuration={400}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-placeholder">
                <div className="spinner" style={{ width: 24, height: 24 }} />
                <p>Connecting to market data stream…</p>
              </div>
            )}
          </div>

          <div className="chart-legend">
            <span className="legend-item">
              <span className="legend-dot" style={{ background: '#4caf50' }} /> Maize spot price
            </span>
            <span className="legend-item">
              <span className="legend-dash" style={{ background: '#fbc02d' }} /> Settlement threshold (KES 3,500)
            </span>
          </div>
        </div>

        {/* Terminal Log */}
        <TerminalMonitor logs={logs} />
      </div>
    </div>
  )
}
