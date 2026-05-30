// api/client.ts — Typed API client for MazaoPlus (Phase 2)

export interface ProduceReceipt {
  id: string
  farmer_id: string
  commodity_type: string
  quantity_bags: number
  grade_info: string
  holding_cost_per_bag_month: number
  price_at_deposit: number      // market price captured at warehouse entry — FROZEN
  deposit_value_kes: number     // bags × price_at_deposit — the loan basis, NEVER changes
  status: 'AVAILABLE' | 'LOCKED_COLLATERAL' | 'SETTLED'
  created_at: string
}

export interface Loan {
  id: string
  receipt_id: string
  farmer_id: string
  principal_amount: number  // 60% of deposit_value_kes — fixed at issuance
  interest_rate: number
  is_settled: boolean
  created_at: string
}

export interface EnrichedReceipt extends ProduceReceipt {
  current_market_value_kes: number  // bags × live price (informational)
  max_loan_kes: number              // 60% of deposit_value_kes (stable basis)
  current_price_kes: number         // live spot price
  active_loan?: Loan
}

export interface MarketPrice {
  commodity: string
  current_price: number
  target_threshold: number
  price_history: number[]
  timestamp: string
}

export interface AgentLogEntry {
  timestamp: string
  level: 'INFO' | 'WARN' | 'TRIGGER' | 'PAYOUT' | 'ERROR'
  message: string
}

export interface LoanApplicationResponse {
  loan: Loan
  disbursed_kes: number
  deposit_value_kes: number   // value at entry time (not current market)
  ltv_percent: number
}

export interface USSDRequest {
  session_id: string
  farmer_id: string
  text: string
}

export interface USSDResponse {
  type: 'CON' | 'END'
  message: string
}

// ---- API Functions -----------------------------------------------------------

const BASE = '/api/v1'

/** POST /api/v1/receipts */
export async function createReceipt(data: {
  farmer_id: string
  commodity_type: string
  quantity_bags: number
  grade_info: string
}): Promise<ProduceReceipt> {
  const res = await fetch(`${BASE}/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Failed to create receipt')
  }
  return res.json()
}

/** GET /api/v1/receipts/farmer/:id */
export async function getFarmerReceipts(farmerId: string): Promise<{
  farmer_id: string
  receipts: EnrichedReceipt[]
  count: number
}> {
  const id = farmerId.trim().toUpperCase()
  if (!id) throw new Error('Farmer ID is required')
  const res = await fetch(`${BASE}/receipts/farmer/${encodeURIComponent(id)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Failed to fetch receipts')
  }
  const data = await res.json()
  // Ensure receipts is always an array (never null)
  return { ...data, receipts: data.receipts ?? [] }
}

/** POST /api/v1/loans/apply */
export async function applyForLoan(data: {
  receipt_id: string
  farmer_id: string
}): Promise<LoanApplicationResponse> {
  const res = await fetch(`${BASE}/loans/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Failed to apply for loan')
  }
  return res.json()
}

/** GET /api/v1/market/status */
export async function getMarketStatus(): Promise<MarketPrice> {
  const res = await fetch(`${BASE}/market/status`)
  if (!res.ok) throw new Error('Failed to fetch market status')
  return res.json()
}

/** POST /api/v1/ussd — USSD state machine */
export async function sendUSSD(req: USSDRequest): Promise<USSDResponse> {
  const res = await fetch(`${BASE}/ussd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error('USSD request failed')
  return res.json()
}

/** EventSource for SSE log stream */
export function createLogStream(): EventSource {
  return new EventSource(`${BASE}/logs/stream`)
}

/** Format KES currency */
export function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Format a timestamp */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Generate a session ID for USSD */
export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
