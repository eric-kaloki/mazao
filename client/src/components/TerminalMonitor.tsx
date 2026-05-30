import { useEffect, useRef } from 'react'
import { Terminal } from 'lucide-react'
import { type AgentLogEntry, formatTime } from '../api/client'
import './TerminalMonitor.css'

interface Props {
  logs: AgentLogEntry[]
}

const LEVEL_COLORS: Record<AgentLogEntry['level'], string> = {
  INFO:    'var(--color-green-400)',
  WARN:    'var(--color-gold-800)',
  TRIGGER: 'var(--color-gold-400)',
  PAYOUT:  'var(--color-payout)',
  ERROR:   'var(--color-error)',
  ARBITRATION: '#F6AD55', // Orange for Arbitration
}

const LEVEL_LABELS: Record<AgentLogEntry['level'], string> = {
  INFO:    'INFO   ',
  WARN:    'WARN   ',
  TRIGGER: 'TRIGGER',
  PAYOUT:  'PAYOUT ',
  ERROR:   'ERROR  ',
  ARBITRATION: 'ARBITR ',
}

export default function TerminalMonitor({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new log entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="terminal-panel glass-card animate-in" id="terminal-monitor">
      <div className="terminal-header">
        <div className="terminal-dots">
          <span className="tdot tdot--red" />
          <span className="tdot tdot--yellow" />
          <span className="tdot tdot--green" />
        </div>
        <div className="terminal-title">
          <Terminal size={13} />
          <span>mazaoplus-agent — stdout</span>
        </div>
        <div className="terminal-badge">
          <span className="status-dot status-live" style={{ width: 6, height: 6 }} />
          <span>Live</span>
        </div>
      </div>

      <div className="terminal-body" id="terminal-body">
        {logs.length === 0 && (
          <div className="terminal-connecting">
            <span className="spinner" style={{ width: 14, height: 14 }} />
            <span> Connecting to agent stream…</span>
          </div>
        )}

        {logs.map((entry, i) => (
          <div
            key={i}
            className={`log-line ${entry.level === 'TRIGGER' || entry.level === 'PAYOUT' ? 'log-line--highlight' : ''}`}
          >
            <span className="log-time">{formatTime(entry.timestamp)}</span>
            <span className="log-level" style={{ color: LEVEL_COLORS[entry.level] }}>
              {LEVEL_LABELS[entry.level]}
            </span>
            <span className="log-msg" style={{ color: LEVEL_COLORS[entry.level] }}>
              {entry.message}
            </span>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="terminal-footer">
        <span>{logs.length} entries</span>
        <span className="terminal-footer-hint">Auto-scrolling · Real-time SSE stream</span>
      </div>
    </div>
  )
}
