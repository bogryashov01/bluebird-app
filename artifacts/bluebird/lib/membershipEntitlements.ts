import type { ProductionPlan } from './productionMembershipPlans';

export type PassBalancePresentation =
  | { kind: 'unlimited' }
  | { kind: 'remaining'; count: number }
  | { kind: 'unknown' };

/**
 * Remaining pass balances come from GET /api/me/profile upgradeCreditBalances.
 * Unlimited entitlements come from the member's plan on GET /api/plans.
 * Demo credits and local purchases are never passed into this helper.
 */
export function presentPassBalance(input: {
  unlimited: boolean | null | undefined;
  remaining: number | null | undefined;
}): PassBalancePresentation {
  if (input.unlimited === true) return { kind: 'unlimited' };
  if (
    typeof input.remaining === 'number'
    && Number.isSafeInteger(input.remaining)
    && input.remaining >= 0
  ) {
    return { kind: 'remaining', count: input.remaining };
  }
  return { kind: 'unknown' };
}

export function formatPassBalanceValue(presentation: PassBalancePresentation): string {
  if (presentation.kind === 'unlimited') return 'Unlimited';
  if (presentation.kind === 'remaining') return String(presentation.count);
  return '\u2014';
}

export function passBalanceAccessibilityLabel(
  label: string,
  presentation: PassBalancePresentation,
): string {
  if (presentation.kind === 'unlimited') return `${label}, unlimited`;
  if (presentation.kind === 'remaining') return `${label}, ${presentation.count}`;
  return `${label} unavailable`;
}

export function presentPlanIncludedPasses(plan: ProductionPlan | null | undefined): {
  skipTheLine: PassBalancePresentation;
  international: PassBalancePresentation;
} {
  if (!plan) {
    return { skipTheLine: { kind: 'unknown' }, international: { kind: 'unknown' } };
  }
  return {
    skipTheLine: presentPassBalance({
      unlimited: plan.skipTheLineUnlimited,
      remaining: plan.includedSkipTheLinePasses,
    }),
    international: presentPassBalance({
      unlimited: plan.internationalUnlimited,
      remaining: plan.includedInternationalPasses,
    }),
  };
}
