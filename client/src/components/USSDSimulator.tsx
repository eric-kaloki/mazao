import { useState, useRef, useEffect } from 'react'
import { sendUSSD, getMarketStatus, generateSessionId, type USSDResponse, formatKES } from '../api/client'
import './USSDSimulator.css'

interface ScreenLine {
  text: string
  type: 'header' | 'body' | 'input' | 'system'
}

// Parse the USSD response message into displayable lines
function parseLines(message: string): ScreenLine[] {
  const raw = message.replace(/^(CON|END)\s*/, '')
  return raw.split('\n').map((line, i) => ({
    text: line,
    type: i === 0 ? 'header' : 'body',
  }))
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
]

export default function USSDSimulator() {
  const [sessionId] = useState(generateSessionId)
  const [inputText, setInputText] = useState('')         // accumulated USSD path e.g. "1*F001"
  const [displayInput, setDisplayInput] = useState('')   // what shows on the screen input line
  const [response, setResponse] = useState<USSDResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [sessionEnded, setSessionEnded] = useState(false)
  const screenRef = useRef<HTMLDivElement>(null)

  // Fetch live market price for the status bar
  useEffect(() => {
    getMarketStatus().then(p => setCurrentPrice(p.current_price)).catch(() => {})
    const interval = setInterval(() => {
      getMarketStatus().then(p => setCurrentPrice(p.current_price)).catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll screen to bottom
  useEffect(() => {
    if (screenRef.current) {
      screenRef.current.scrollTop = screenRef.current.scrollHeight
    }
  }, [response])

  // Start session on mount
  useEffect(() => {
    sendSession('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendSession = async (text: string) => {
    setLoading(true)
    try {
      const res = await sendUSSD({ session_id: sessionId, farmer_id: '', text })
      setResponse(res)
      if (res.type === 'END') {
        setSessionEnded(true)
      }
    } catch {
      setResponse({ type: 'END', message: 'END Network error.\nPlease try again.' })
      setSessionEnded(true)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (key: string) => {
    if (loading || sessionEnded) return

    if (key === '#') {
      // # = backspace/delete one character from display input
      setDisplayInput(prev => prev.slice(0, -1))
      return
    }

    if (key === '*') {
      // * = back / submit with accumulated input
      if (displayInput) {
        // User typed something, submit with * separator
        const nextText = inputText ? `${inputText}*${displayInput}` : displayInput
        setInputText(nextText)
        setDisplayInput('')
        sendSession(nextText)
      } else {
        // Empty * = go back one level (remove last segment)
        const parts = inputText.split('*').filter(Boolean)
        parts.pop()
        const backText = parts.join('*')
        setInputText(backText)
        sendSession(backText)
      }
      return
    }

    // Numeric key: append to display input
    setDisplayInput(prev => prev + key)
  }

  // Handle typed text submission (Enter key)
  const handleSubmit = () => {
    if (loading || sessionEnded || !displayInput.trim()) return
    const segment = displayInput.trim().toUpperCase()
    const nextText = inputText ? `${inputText}*${segment}` : segment
    setInputText(nextText)
    setDisplayInput('')
    sendSession(nextText)
  }

  const handleRestart = () => {
    setInputText('')
    setDisplayInput('')
    setSessionEnded(false)
    setResponse(null)
    sendSession('')
  }

  const lines = response ? parseLines(response.message) : []

  return (
    <div className="ussd-layout">
      {/* ---- Page Header --------------------------------------------------- */}
      <div className="page-header animate-in">
        <div className="page-header-icon" style={{ color: 'var(--color-gold-700)' }}>
          📱
        </div>
        <div>
          <h2 className="page-title">USSD Simulator</h2>
          <p className="page-subtitle">
            Feature phone simulation — how farmers without smartphones access MazaoPlus via *483*1#
          </p>
        </div>
      </div>

      <div className="ussd-content">
        {/* ---- Phone Frame ------------------------------------------------- */}
        <div className="phone-frame animate-in">
          {/* Speaker */}
          <div className="phone-speaker" />

          {/* Status bar */}
          <div className="phone-statusbar">
            <span>Safaricom</span>
            {currentPrice !== null && (
              <span className="phone-price-ticker">
                Maize {formatKES(currentPrice)}/bag
              </span>
            )}
            <span>▐▐▐ 3G</span>
          </div>

          {/* USSD screen */}
          <div className="phone-screen" ref={screenRef}>
            {loading && !response && (
              <div className="screen-connecting">Connecting…</div>
            )}

            {lines.map((line, i) => (
              <div
                key={i}
                className={`screen-line screen-line--${line.type} ${i === 0 ? 'screen-line--title' : ''}`}
              >
                {line.text || '\u00A0'}
              </div>
            ))}

            {/* Current input line */}
            {!sessionEnded && (
              <div className="screen-input-line">
                <span className="screen-prompt">&gt;</span>
                <span className="screen-input-text">{displayInput}</span>
                <span className="screen-cursor">█</span>
              </div>
            )}

            {sessionEnded && (
              <div className="screen-ended">— Session Ended —</div>
            )}
          </div>

          {/* Softkey row */}
          <div className="phone-softkeys">
            <button
              className="softkey softkey-left"
              onClick={() => { setDisplayInput(''); handleSubmit() }}
              disabled={loading || sessionEnded}
            >
              {sessionEnded ? '' : 'OK'}
            </button>
            <div className="phone-dpad">
              <div className="dpad-center" />
            </div>
            <button
              className="softkey softkey-right"
              onClick={sessionEnded ? handleRestart : () => handleKeyPress('#')}
            >
              {sessionEnded ? 'New' : '⌫'}
            </button>
          </div>

          {/* Keypad */}
          <div className="phone-keypad">
            {KEYS.map((row, ri) => (
              <div key={ri} className="keypad-row">
                {row.map(key => (
                  <button
                    key={key}
                    className={`key-btn ${key === '*' ? 'key-special' : ''} ${key === '#' ? 'key-special' : ''}`}
                    onClick={() => {
                      if (key === '*') handleSubmit()
                      else handleKeyPress(key)
                    }}
                    disabled={loading || sessionEnded}
                    id={`ussd-key-${key === '*' ? 'star' : key === '#' ? 'hash' : key}`}
                  >
                    <span className="key-main">{key === '*' ? 'Send' : key}</span>
                    {key !== '*' && key !== '#' && (
                      <span className="key-sub">
                        {{'0':'','1':'','2':'ABC','3':'DEF','4':'GHI','5':'JKL','6':'MNO','7':'PQRS','8':'TUV','9':'WXYZ','#':''}[key]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}

            {/* Call / End row */}
            <div className="keypad-row keypad-call-row">
              <button className="call-btn call-btn--green" onClick={handleSubmit} disabled={loading || sessionEnded}>
                ✆
              </button>
              <button className="call-btn call-btn--red" onClick={handleRestart}>
                ✕
              </button>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="phone-brand">MazaoPlus · *483*1#</div>
          <div className="phone-chin" />
        </div>

        {/* ---- USSD Guide -------------------------------------------------- */}
        <div className="ussd-guide animate-in">
          <div className="glass-card guide-card">
            <h3>USSD Menu Flow</h3>
            <div className="flow-tree">
              <div className="flow-node flow-node--root">*483*1# (dial)</div>
              <div className="flow-children">
                <div className="flow-branch">
                  <div className="flow-node">1 → My Receipts</div>
                  <div className="flow-desc">Enter Farmer ID → see all receipts + status</div>
                </div>
                <div className="flow-branch">
                  <div className="flow-node">2 → Cash Advance</div>
                  <div className="flow-desc">Enter ID → confirm loan → M-Pesa disbursed</div>
                </div>
                <div className="flow-branch">
                  <div className="flow-node">3 → Market Price</div>
                  <div className="flow-desc">Instant price + distance to threshold</div>
                </div>
                <div className="flow-branch">
                  <div className="flow-node">4 → Loan Balance</div>
                  <div className="flow-desc">Enter ID → total owed incl. interest + fees</div>
                </div>
                <div className="flow-branch">
                  <div className="flow-node">5 → Auto-Sell Settings</div>
                  <div className="flow-desc">Toggle agent auto-sell for locked receipts</div>
                </div>
                <div className="flow-branch">
                  <div className="flow-node">6 → Credit Profile</div>
                  <div className="flow-desc">View score and eligible loan products</div>
                </div>
              </div>
            </div>

            <div className="guide-tip">
              <h4>How to use the keypad</h4>
              <ul>
                <li><kbd>1–9</kbd> Type your selection or Farmer ID characters</li>
                <li><kbd>Send / ✆</kbd> Confirm selection and advance</li>
                <li><kbd>⌫ / #</kbd> Delete last character</li>
                <li><kbd>✕</kbd> End session and restart</li>
              </ul>
            </div>

            <div className="guide-tip guide-tip--gold">
              <h4>Why USSD?</h4>
              <p>
                Over 70% of Kenyan smallholder farmers use feature phones. USSD works on
                any mobile network, requires zero data, and runs even on 2G coverage.
                MazaoPlus reaches farmers where smartphones cannot.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
