export type ReferralCode = string;
export type InviteUrl = string;

/**
 * Approved limited integration test. The Referral screen may read
 * GET /api/me/referrals for the signed-in Clerk user. Invite validation,
 * pricing preview, and credit redemption stay closed.
 */
export const REFERRAL_ACCOUNT_READS_ENABLED = true;

export function areReferralAccountReadsEnabled(): boolean {
  return REFERRAL_ACCOUNT_READS_ENABLED === true;
}

export interface ReferralStatistics {
  friendsActivated: number;
  creditEarnedCents: number;
  creditAppliedCents: number;
  balanceCents: number;
}

export interface ReferralSnapshot {
  code: ReferralCode;
  inviteUrl: InviteUrl;
  statistics: ReferralStatistics;
}

export interface InviteValidationResult {
  valid: boolean;
  code: ReferralCode;
}

export type MembershipPricingPreview = Readonly<Record<string, unknown>>;

export interface ReferralRepository {
  getReferralSnapshot(signal?: AbortSignal): Promise<ReferralSnapshot>;
  validateCode(code: ReferralCode, signal?: AbortSignal): Promise<InviteValidationResult>;
  previewMembershipPricing(
    tier: 'base' | 'plus',
    code: ReferralCode,
    signal?: AbortSignal,
  ): Promise<MembershipPricingPreview>;
}

export interface ReferralMainApi {
  getReferrals(options?: { signal?: AbortSignal }): Promise<ReferralSnapshot>;
}

export class ReferralContractUnavailableError extends Error {
  constructor(message = 'Referral details are unavailable from the selected Main API.') {
    super(message);
    this.name = 'ReferralContractUnavailableError';
  }
}

const REFERRAL_ACCOUNT_KEYS = new Set([
  'code',
  'shareUrl',
  'successfulReferrals',
  'creditEarnedCents',
  'creditAppliedCents',
  'creditBalanceCents',
]);
const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const REFERRAL_SHARE_HOSTS = new Set([
  'bluebirdjets.com',
  'www.bluebirdjets.com',
  'bluebird.co',
  'www.bluebird.co',
]);

export class ProductionReferralRepository implements ReferralRepository {
  constructor(private readonly api: ReferralMainApi) {}

  async getReferralSnapshot(signal?: AbortSignal): Promise<ReferralSnapshot> {
    if (!areReferralAccountReadsEnabled()) {
      throw new ReferralContractUnavailableError();
    }
    return this.api.getReferrals({ signal });
  }

  async validateCode(): Promise<InviteValidationResult> {
    throw new ReferralContractUnavailableError();
  }

  async previewMembershipPricing(): Promise<MembershipPricingPreview> {
    throw new ReferralContractUnavailableError();
  }
}

export function createProductionReferralRepository(api: ReferralMainApi): ReferralRepository {
  return new ProductionReferralRepository(api);
}

const REFERRAL_AMOUNT_FIELDS = [
  'successfulReferrals',
  'creditEarnedCents',
  'creditAppliedCents',
  'creditBalanceCents',
] as const;

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ReferralContractUnavailableError();
  }
  return value;
}

function amountRejectionReason(value: unknown): string | null {
  if (typeof value !== 'number') return 'type';
  if (!Number.isSafeInteger(value)) return 'integer';
  if (value < 0) return 'negative';
  return null;
}

function inspectReferralShareUrl(
  value: string,
  code: string,
): { reason: string | null; href: string | null } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { reason: 'share-url-unparsed', href: null };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { reason: 'share-url-protocol', href: null };
  }
  if (url.username !== '' || url.password !== '') {
    return { reason: 'share-url-credentials', href: null };
  }
  if (url.port !== '') return { reason: 'share-url-port', href: null };
  if (url.search !== '') return { reason: 'share-url-query', href: null };
  if (url.hash !== '') return { reason: 'share-url-hash', href: null };
  if (!REFERRAL_SHARE_HOSTS.has(url.hostname)) return { reason: 'share-url-host', href: null };
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const matched = segments.some((segment) => {
    try {
      return decodeURIComponent(segment) === code;
    } catch {
      return false;
    }
  });
  if (!matched) return { reason: 'share-url-path', href: null };
  url.protocol = 'https:';
  if (!url.href.startsWith('https://')) return { reason: 'share-url-protocol', href: null };
  return { reason: null, href: url.href };
}

function shareUrlRejectionReason(value: string, code: string): string | null {
  return inspectReferralShareUrl(value, code).reason;
}

/**
 * Names the first parser check that rejects a referral payload.
 * The result is a fixed reason code and contains no account data.
 */
export function referralSchemaRejectionReason(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not-object';
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!REFERRAL_ACCOUNT_KEYS.has(key)) return 'unexpected-field';
  }
  if (typeof raw.code !== 'string') return 'code-type';
  if (!REFERRAL_CODE_PATTERN.test(raw.code)) return 'code-pattern';
  if (typeof raw.shareUrl !== 'string') return 'share-url-type';
  const shareReason = shareUrlRejectionReason(raw.shareUrl, raw.code);
  if (shareReason) return shareReason;
  for (const field of REFERRAL_AMOUNT_FIELDS) {
    const reason = amountRejectionReason(raw[field]);
    if (reason) return `${field}-${reason}`;
  }
  return 'none';
}

function normalizedReferralShareUrl(value: string, code: string): string | null {
  return inspectReferralShareUrl(value, code).href;
}

/**
 * Parses the verified GET /api/me/referrals account projection.
 * The share host must be a known Bluebird host. An Origin-derived host is rejected.
 */
export function parseReferralAccountResponse(value: unknown): ReferralSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReferralContractUnavailableError();
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!REFERRAL_ACCOUNT_KEYS.has(key)) throw new ReferralContractUnavailableError();
  }
  const code = raw.code;
  const shareUrl = raw.shareUrl;
  if (typeof code !== 'string' || !REFERRAL_CODE_PATTERN.test(code)) {
    throw new ReferralContractUnavailableError();
  }
  const inviteUrl = typeof shareUrl === 'string' ? normalizedReferralShareUrl(shareUrl, code) : null;
  if (!inviteUrl) {
    throw new ReferralContractUnavailableError();
  }
  return {
    code,
    inviteUrl,
    statistics: mapReferralStatistics({
      friendsActivated: nonNegativeInteger(raw.successfulReferrals),
      creditEarnedCents: nonNegativeInteger(raw.creditEarnedCents),
      creditAppliedCents: nonNegativeInteger(raw.creditAppliedCents),
      balanceCents: nonNegativeInteger(raw.creditBalanceCents),
    }),
  };
}

export function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isReferralCode(value: unknown): value is string {
  return typeof value === 'string' && /^BB-[A-Z0-9][A-Z0-9-]{1,31}$/.test(value);
}

export function mapReferralStatistics(input: ReferralStatistics): ReferralStatistics {
  const fields: (keyof ReferralStatistics)[] = [
    'friendsActivated',
    'creditEarnedCents',
    'creditAppliedCents',
    'balanceCents',
  ];
  for (const field of fields) {
    const value = input[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ReferralContractUnavailableError(`Referral statistics are invalid (${field}).`);
    }
  }
  return { ...input };
}

const REFERRAL_DIAGNOSTIC_KEYS = [
  'phase',
  'requestAttempted',
  'exactUrlPermitted',
  'tokenObtained',
  'fetchReached',
  'httpStatus',
  'failureCategory',
  'fieldNames',
  'shareHostname',
  'codeAccepted',
  'shareHostTrusted',
  'schemaReason',
] as const;

export function logReferralDiagnostic(
  details: Partial<Record<(typeof REFERRAL_DIAGNOSTIC_KEYS)[number], string | number>>,
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const parts = REFERRAL_DIAGNOSTIC_KEYS.flatMap((key) => {
    const value = details[key];
    return value === undefined ? [] : [`${key}=${value}`];
  });
  console.log(`[bluebird-referral] ${parts.join(' ')}`);
}

export function logReferralResponseShape(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    logReferralDiagnostic({
      phase: 'response',
      fieldNames: 'not-object',
      shareHostname: 'absent',
      codeAccepted: 'absent',
      shareHostTrusted: 'absent',
      schemaReason: 'not-object',
    });
    return;
  }
  const raw = value as Record<string, unknown>;
  const fieldNames = Object.keys(raw).map((key) => (
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ? key : 'redacted-field'
  )).sort().join(',') || 'none';
  const codeAccepted = typeof raw.code !== 'string'
    ? 'absent'
    : REFERRAL_CODE_PATTERN.test(raw.code) ? 'yes' : 'no';
  let shareHostname = 'absent';
  let shareHostTrusted = 'absent';
  if (typeof raw.shareUrl === 'string' && raw.shareUrl.length > 0 && raw.shareUrl.length <= 2048) {
    try {
      const hostname = new URL(raw.shareUrl).hostname.toLowerCase();
      if (/^[a-z0-9.-]{1,253}$/.test(hostname)) {
        shareHostname = hostname;
        shareHostTrusted = REFERRAL_SHARE_HOSTS.has(hostname) ? 'yes' : 'no';
      } else {
        shareHostname = 'unparsed';
        shareHostTrusted = 'no';
      }
    } catch {
      shareHostname = 'unparsed';
      shareHostTrusted = 'no';
    }
  }
  logReferralDiagnostic({
    phase: 'response',
    fieldNames,
    shareHostname,
    codeAccepted,
    shareHostTrusted,
    schemaReason: referralSchemaRejectionReason(value),
  });
}

export function logReferralTransportFailure(
  error: unknown,
  httpStatus: number,
  exactUrlPermitted: boolean,
  tokenObtained: 'not-requested' | 'yes' | 'no',
  fetchReached: boolean,
): void {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message : '';
  let failureCategory = 'unknown';
  if (message.includes('permits only GET /api/me')) failureCategory = 'allowlist';
  else if (code === 'token') failureCategory = 'token';
  else if (code === 'session_expired' || code === 'http') failureCategory = 'http';
  else if (code === 'network') failureCategory = 'network';
  else if (code === 'timeout') failureCategory = 'timeout';
  else if (code === 'invalid_json') failureCategory = 'invalid-json';
  else if (code === 'invalid_schema') failureCategory = 'schema';
  else if (code === 'cancelled') failureCategory = 'cancelled';
  logReferralDiagnostic({
    phase: 'result',
    requestAttempted: 'yes',
    exactUrlPermitted: exactUrlPermitted ? 'yes' : 'no',
    tokenObtained,
    fetchReached: fetchReached ? 'yes' : 'no',
    ...(httpStatus > 0 ? { httpStatus } : {}),
    failureCategory,
  });
}

export function formatReferralCredit(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new TypeError('Referral credit must be a non-negative integer number of cents.');
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
