/**
 * client.ts — Recode IT HTTP API client (Phase 3).
 *
 * Thin wrapper around fetch() with:
 *   - JSON request/response by default
 *   - credentials: 'include' so the recode_jwt HttpOnly cookie travels
 *   - normalized error model: every non-2xx surfaces as ApiError with
 *     { status, error, message } shape from backend/http_utils.py
 *
 * The client deliberately does NOT touch crypto.ts — encryption happens at
 * the call site so the wire payload is always opaque bytes (base64) by the
 * time it hits this module. Keeps the security-critical paths short.
 */

export type ApiErrorBody = {
  error: string
  message: string
  [k: string]: unknown
}

export class ApiError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly body: ApiErrorBody | null

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.message ?? fallback)
    this.status = status
    this.code = body?.error ?? 'unknown_error'
    this.body = body
  }
}

const DEFAULT_BASE_URL =
  typeof window !== 'undefined' && (window as { __RECODE_IT_API__?: string }).__RECODE_IT_API__
    ? (window as unknown as { __RECODE_IT_API__: string }).__RECODE_IT_API__
    : ''

export type ClientConfig = { baseUrl?: string; fetchImpl?: typeof fetch }

let _config: Required<ClientConfig> = {
  baseUrl: DEFAULT_BASE_URL,
  fetchImpl: typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch),
}

export function configure(cfg: ClientConfig): void {
  _config = {
    baseUrl: cfg.baseUrl ?? _config.baseUrl,
    fetchImpl: cfg.fetchImpl ?? _config.fetchImpl,
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${_config.baseUrl}${path}`
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }
  const resp = await _config.fetchImpl(url, init)
  const text = await resp.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }
  if (!resp.ok) {
    throw new ApiError(
      resp.status,
      parsed as ApiErrorBody | null,
      `HTTP ${resp.status}`,
    )
  }
  return parsed as T
}

// ----- Auth -----

export type SignupResponse = {
  user_id: string
  email: string
  kdf_salt: string
  recovery_codes: string[]
  warning: string
}

export type SignupInput = {
  email: string
  password: string
  /** Display name — required by the backend (1..256 char). */
  name: string
  /**
   * Newsletter opt-in checkbox at signup time. Default false (decisione
   * ratificata, capabilities_index §9). The backend stamps the consent only
   * after the user clicks the verification email (double opt-in).
   */
  marketing_consent_requested?: boolean
}

export function signup(input: SignupInput): Promise<SignupResponse> {
  return request<SignupResponse>('POST', '/recode/signup', {
    email: input.email,
    password: input.password,
    name: input.name,
    marketing_consent_requested: input.marketing_consent_requested ?? false,
  })
}

export type LoginResponse = {
  user_id: string
  email: string
  kdf_salt: string
  email_verified: boolean
  expires_at: string
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('POST', '/recode/login', { email, password })
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>('POST', '/recode/logout')
}

export type Tier = 'free' | 'pro'

export type MeResponse = {
  user_id: string
  email: string
  kdf_salt: string
  email_verified: boolean
  created_at: string
  /** 'free' = IndexedDB local mapping; 'pro' = server cifrato. */
  tier: Tier
  /** Display name collected at signup. */
  name: string
  marketing_consent: boolean
}

export function setMarketingConsent(subscribe: boolean): Promise<{ marketing_consent: boolean }> {
  return request(subscribe ? 'POST' : 'DELETE', '/recode/me/marketing-consent')
}

export function me(): Promise<MeResponse> {
  return request<MeResponse>('GET', '/recode/me')
}

// ----- Mappings -----

export type MappingMetadata = {
  mapping_id: string
  label: string | null
  doc_type: string | null
  size_bytes: number
  created_at: string
  last_accessed_at: string | null
}

export type MappingPayload = MappingMetadata & { blob: string }

export function listMappings(): Promise<{ mappings: MappingMetadata[] }> {
  return request('GET', '/recode/mappings/')
}

export function getMapping(mappingId: string): Promise<MappingPayload> {
  return request('GET', `/recode/mappings/${encodeURIComponent(mappingId)}`)
}

export function saveMapping(input: {
  mapping_id: string
  blob_base64: string
  label?: string
  doc_type?: string
}): Promise<{ mapping_id: string; created_at: string; size_bytes: number }> {
  return request('POST', '/recode/mappings/', {
    mapping_id: input.mapping_id,
    blob: input.blob_base64,
    label: input.label,
    doc_type: input.doc_type,
  })
}

export function deleteMapping(mappingId: string): Promise<{ ok: true }> {
  return request('DELETE', `/recode/mappings/${encodeURIComponent(mappingId)}`)
}

export function deleteMappingsBulk(
  opts: { olderThan?: string; all?: boolean },
): Promise<{ deleted: number }> {
  const params = new URLSearchParams()
  if (opts.olderThan) params.set('older_than', opts.olderThan)
  if (opts.all) params.set('all', 'true')
  return request(
    'DELETE',
    `/recode/mappings/${params.toString() ? '?' + params.toString() : ''}`,
  )
}

export type FalsePositiveEntry = { term: string; category: string }

export function getFalsePositives(): Promise<{
  false_positives: Array<FalsePositiveEntry & { marked_at: string }>
}> {
  return request('GET', '/recode/false-positives/')
}

export function patchMappingFalsePositives(
  mappingId: string,
  body: { add?: FalsePositiveEntry[]; remove?: FalsePositiveEntry[] },
): Promise<{ added: number; removed: number; mapping_id: string }> {
  return request(
    'PATCH',
    `/recode/mappings/${encodeURIComponent(mappingId)}/false-positives`,
    body,
  )
}

// ----- Recovery / Account -----

export function requestRecovery(email: string): Promise<{ ok: true }> {
  return request('POST', '/recode/recovery/initiate', { email })
}

export function verifyRecovery(
  token: string,
  recoveryCode: string,
  newPassword: string,
): Promise<{
  ok: true
  mappings_destroyed: number
  kdf_salt: string
  message: string
}> {
  return request('POST', '/recode/recovery/verify', {
    token,
    recovery_code: recoveryCode,
    new_password: newPassword,
  })
}

export function deleteAccount(password: string): Promise<{
  ok: true
  deleted_user_id: string
}> {
  return request('DELETE', '/recode/account/', {
    password,
    confirm: 'DELETE MY ACCOUNT',
  })
}

// ----- Pro upgrade funnel (Phase 1: request-then-invite, Stripe €0/mese) -----

export type ProInviteStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'claimed'
  | 'expired'

export type ProInviteRequestRow = {
  request_id: number
  status: ProInviteStatus
  requested_at: string
  approved_at: string | null
  claimed_at: string | null
  rejected_at: string | null
  invite_expires_at: string | null
}

export type ProInviteRequestCreated = {
  request_id: number
  status: 'pending'
  requested_at: string
}

export function requestProInvite(reason: string): Promise<ProInviteRequestCreated> {
  return request('POST', '/recode/pro/request-invite', { reason })
}

export function getMyProRequest(): Promise<{ request: ProInviteRequestRow | null }> {
  return request('GET', '/recode/pro/my-request')
}

export type ClaimInviteResponse = {
  stripe_payment_link_url: string
  user_id: string
  expires_at: string
}

export function claimProInvite(token: string): Promise<ClaimInviteResponse> {
  return request('POST', '/recode/pro/claim-invite', { token })
}
