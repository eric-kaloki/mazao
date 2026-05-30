// api/client.ts — Typed API client for MazaoPlus
// All fetch calls go through here. In dev, Vite proxies /api to :8080.

export interface ProduceReceipt {
  id: string
  farmer_id: string
  commodity_type: string
  quantity_bags: number
  grade_info: string
  holding_cost_per_bag_month: number
  status: 'AVAILABLE' | 'LOCKED_COLLATERAL' | 'SETTLED'
  created_at: string
}

export interface Loan {
  id: string
  receipt_id: string
  farmer_id: string
  principal_amount: number
  interest_rate: number
  is_settled: boolean
  created_at: string
}

export interface EnrichedReceipt extends ProduceReceipt {
  market_value_kes: number
  max_loan_kes: number
  current_price_kes: number
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
  market_value_at_application: number
  ltv_percent: number
}

// ---- API Functions -----------------------------------------------------------

const BASE = '/api/v1'

/** POST /api/v1/receipts — Warehouse manager logs a new grain deposit */
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

/** GET /api/v1/receipts/farmer/:id — Fetch all receipts for a farmer */
export async function getFarmerReceipts(farmerId: string): Promise<{
  farmer_id: string
  receipts: EnrichedReceipt[]
  count: number
}> {
  const res = await fetch(`${BASE}/receipts/farmer/${encodeURIComponent(farmerId)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Failed to fetch receipts')
  }
  return res.json()
}

/** POST /api/v1/loans/apply — Apply for a 60% LTV micro-loan */
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

/** GET /api/v1/market/status — Fetch current market price + history */
export async function getMarketStatus(): Promise<MarketPrice> {
  const res = await fetch(`${BASE}/market/status`)
  if (!res.ok) throw new Error('Failed to fetch market status')
  return res.json()
}

/** Returns an EventSource connected to the SSE log stream */
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

/** Format a timestamp for display */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
