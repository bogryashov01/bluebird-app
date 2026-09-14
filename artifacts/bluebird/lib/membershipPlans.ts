import type { MembershipPlan, MembershipPlanId } from '@workspace/api-client-react';

export const TIER_ORDER: Record<string, number> = {
  none: -1,
  base: 0,
  plus: 1,
  concierge: 2,
};

export const TIER_COLORS: Record<MembershipPlanId, string> = {
  base: '#8896B3',
  plus: '#1259F2',
  concierge: '#F59E0B',
};

export const TIER_TAGLINES: Record<MembershipPlanId, string> = {
  base: 'Get started with private aviation',
  plus: 'More access, more freedom',
  concierge: 'The complete Bluebird experience',
};

export const FALLBACK_TIER_LABELS: Record<string, string> = {
  none: 'Not a member yet',
  base: 'Base',
  plus: 'Plus',
  concierge: 'Family/Corporate',
};

export function getTierLabel(tier: string, plans: MembershipPlan[] = []): string {
  return plans.find((plan) => plan.id === tier)?.label ?? FALLBACK_TIER_LABELS[tier] ?? tier;
}

export function getPlan(planId: string | undefined, plans: MembershipPlan[] = []): MembershipPlan | undefined {
  return plans.find((plan) => plan.id === planId);
}

export function formatAnnualPrice(priceAnnualUsd: number): string {
  return `$${Math.round(priceAnnualUsd).toLocaleString('en-US')} / year`;
}

export function formatAnnualTotal(priceAnnualUsd: number): string {
  return `$${priceAnnualUsd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}