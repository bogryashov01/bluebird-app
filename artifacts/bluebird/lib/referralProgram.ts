import type {
  ProductionInviteCode,
  ProductionInviteValidation,
  ProductionMembershipPricingPreview,
  ProductionReferralStatistics,
} from './productionAuthApi';

export type ReferralCode = string;
export type InviteUrl = string;

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
  getInviteCode(options?: { signal?: AbortSignal }): Promise<ProductionInviteCode>;
  getReferrals(options?: { signal?: AbortSignal }): Promise<ProductionReferralStatistics>;
  validateInvite(
    data: { code: string },
    options?: { signal?: AbortSignal },
  ): Promise<ProductionInviteValidation>;
  previewMembershipPricing(
    data: { tier: 'base' | 'plus'; inviteCode?: string },
    options?: { signal?: AbortSignal },
  ): Promise<ProductionMembershipPricingPreview>;
}

export class ReferralContractUnavailableError extends Error {
  constructor(message = 'Referral details are unavailable from the selected Main API.') {
    super(message);
    this.name = 'ReferralContractUnavailableError';
  }
}

export class ProductionReferralRepository implements ReferralRepository {
  constructor(private readonly api: ReferralMainApi) {}

  async getReferralSnapshot(signal?: AbortSignal): Promise<ReferralSnapshot> {
    const [invite, statistics] = await Promise.all([
      this.api.getInviteCode({ signal }),
      this.api.getReferrals({ signal }),
    ]);
    return {
      code: invite.code,
      inviteUrl: invite.inviteUrl,
      statistics: mapReferralStatistics(statistics),
    };
  }

  async validateCode(code: ReferralCode, signal?: AbortSignal): Promise<InviteValidationResult> {
    const result = await this.api.validateInvite({ code: normalizeReferralCode(code) }, { signal });
    return { valid: result.valid, code: result.code };
  }

  async previewMembershipPricing(
    tier: 'base' | 'plus',
    code: ReferralCode,
    signal?: AbortSignal,
  ): Promise<MembershipPricingPreview> {
    return this.api.previewMembershipPricing(
      { tier, ...(code.trim() ? { inviteCode: normalizeReferralCode(code) } : {}) },
      { signal },
    );
  }
}

export function createProductionReferralRepository(api: ReferralMainApi): ReferralRepository {
  return new ProductionReferralRepository(api);
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
