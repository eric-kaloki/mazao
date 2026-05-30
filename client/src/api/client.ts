// api/client.ts — Typed API client for MazaoPlus (Phase 3)

export interface Farmer {
  national_id: string
  full_name: string
  phone_number: string
  wallet_balance: number
  credit_score: number
  credit_band: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM'
  registered_at: string
  loans_settled: number
  loans_defaulted: number
  total_disbursed: number
}

export interface WalletTx {
  id: string
  farmer_id: string
  type: string
  amount: number
  description: string
  timestamp: string
}

export interface ProduceReceipt {
  id: string
  farmer_id: string
  commodity_type: string
  quantity_bags: number
  grade_info: string
  holding_cost_per_bag_month: number
  price_at_deposit: number
  deposit_value_kes: number
  target_sell_price?: number
  status: 'AVAILABLE' | 'LOCKED_COLLATERAL' | 'SETTLED'
  created_at: string
  settled_at?: string
}

export interface Loan {
  id: string
  receipt_id?: string
  farmer_id: string
  loan_type: 'RECEIPT_BACKED' | 'PRE_HARVEST' | 'INPUT_LOAN'
  principal_amount: number
  interest_rate: number
  is_settled: boolean
  created_at: string
  settled_at?: string
}

export interface EnrichedReceipt extends ProduceReceipt {
  current_market_value_kes: number
  max_loan_kes: number
  current_price_kes: number
  active_loan?: Loan
}

export interface CommodityMarket {
  commodity: string
  current_price: number
  price_min: number
  price_max: number
  target_threshold: number
  price_history: number[]
  timestamp: string
}

export interface SettlementResult {
  receipt_id: string
  farmer_id: string
  sale_price: number
  gross_revenue: number
  principal: number
  interest: number
  storage_fee: number
  platform_fee: number
  total_debt: number
  net_profit: number
  days_elapsed: number
}

export interface AgentLogEntry {
  timestamp: string
  level: 'INFO' | 'WARN' | 'TRIGGER' | 'PAYOUT' | 'ERROR' | 'ARBITRATION'
  message: string
}

export interface LoanApplicationResponse {
  loan: Loan
  disbursed_kes: number
  deposit_value_kes: number
  ltv_percent: number
}

export interface InputLoanResponse {
  loan: Loan
  disbursed_kes: number
  credit_score: number
  credit_band: string
  max_allowed_kes: number
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

export async function loginFarmer(nationalId: string, fullName = '', phoneNumber = ''): Promise<Farmer> {
  const res = await fetch(`${BASE}/farmers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ national_id: nationalId, full_name: fullName, phone_number: phoneNumber }),
  })
  if (!res.ok) throw new Error('Login failed')
  return res.json()
}

export async function getFarmerProfile(nationalId: string): Promise<Farmer> {
  const res = await fetch(`${BASE}/farmers/${nationalId}/profile`)
  if (!res.ok) throw new Error('Profile fetch failed')
  return res.json()
}

export async function getFarmerWallet(nationalId: string): Promise<{ balance: number, transactions: WalletTx[] }> {
  const res = await fetch(`${BASE}/farmers/${nationalId}/wallet`)
  if (!res.ok) throw new Error('Wallet fetch failed')
  return res.json()
}

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
  return { ...data, receipts: data.receipts ?? [] }
}

export async function manualSellReceipt(receiptId: string, farmerId: string): Promise<SettlementResult> {
  const res = await fetch(`${BASE}/receipts/${receiptId}/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ farmer_id: farmerId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Manual sell failed')
  }
  return res.json()
}

export async function setTargetPrice(receiptId: string, farmerId: string, targetPrice: number | null): Promise<void> {
  const res = await fetch(`${BASE}/receipts/${receiptId}/target-price`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ farmer_id: farmerId, target_price: targetPrice }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Failed to set target price')
  }
}

export async function applyForLoan(data: {
  receipt_id: string
  farmer_id: string
  requested_amount?: number
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

export async function applyInputLoan(data: {
  farmer_id: string
  loan_type: string
  amount_kes: number
  description: string
}): Promise<InputLoanResponse> {
  const res = await fetch(`${BASE}/loans/input-loan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Input loan failed')
  }
  return res.json()
}

export async function getMarketStatus(): Promise<CommodityMarket> {
  const res = await fetch(`${BASE}/market/status`)
  if (!res.ok) throw new Error('Failed to fetch market status')
  return res.json()
}

export async function getAllMarketPrices(): Promise<CommodityMarket[]> {
  const res = await fetch(`${BASE}/market/all`)
  if (!res.ok) throw new Error('Failed to fetch all markets')
  return res.json()
}

export async function sendUSSD(req: USSDRequest): Promise<USSDResponse> {
  const res = await fetch(`${BASE}/ussd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error('USSD request failed')
  return res.json()
}

export function createLogStream(): EventSource {
  return new EventSource(`${BASE}/logs/stream`)
}

export function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export interface CommodityMetrics {
  total_bags: number
  total_value_kes: number
}

export interface AdminMetrics {
  total_farmers: number
  total_active_loans: number
  total_loan_value_kes: number
  total_collateral_value_kes: number
  total_disbursed: number
  commodities: Record<string, CommodityMetrics>
}

export async function getAdminMetrics(): Promise<AdminMetrics> {
  const res = await fetch(`${BASE}/admin/metrics`)
  if (!res.ok) throw new Error('Failed to fetch admin metrics')
  return res.json()
}
