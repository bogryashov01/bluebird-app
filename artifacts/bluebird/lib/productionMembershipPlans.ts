import {
  fetchProductionJson,
  type ReadRequestOptions,
} from '@/lib/productionFlights';

export const MAIN_BLUEBIRD_MEMBERSHIP_PLANS_PATH = '/plans';

export type ProductionPlanFeatureValue = boolean | string;

export interface ProductionPlan {
  tier: string;
  name: string;
  priceUsd: number;
  cadence: string;
  priceLabel: string;
  cadenceLabel: string;
  tagline: string;
  highlight: boolean;
}

export interface ProductionPlanFeature {
  label: string;
  values: Record<string, ProductionPlanFeatureValue>;
}

export interface ProductionPlanAvailability {
  signupsEnabled: boolean;
  charterEnabled: boolean;
  buyNowEnabled: boolean;
}

export interface ProductionMembershipPlanCatalog {
  plans: ProductionPlan[];
  features: ProductionPlanFeature[];
  cardFeatures: Record<string, string[]>;
  availability: ProductionPlanAvailability;
}

export type ProductionPlanReadOptions = ReadRequestOptions;

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Production plans field "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Production plans field "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function finitePrice(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Production plans field "${field}" must be a non-negative number.`);
  }
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Production plans field "${field}" must be a boolean.`);
  }
  return value;
}

function normalizeSkipTheLineProductName(value: string): string {
  // The public catalog still calls these "upgrades"; customer-facing copy
  // uses the approved Skip the Line Pass name without changing plan benefits.
  return value.replace(
    /Skip[-\s]+the[-\s]+Line\s+upgrades?/gi,
    (match) => `Skip the Line Pass${/upgrades$/i.test(match) ? 'es' : ''}`,
  );
}

function mapPlan(value: unknown, index: number): ProductionPlan {
  const field = `plans[${index}]`;
  const raw = objectValue(value, field);
  const tier = nonEmptyString(raw.tier, `${field}.tier`);
  if (!/^[a-z][a-z0-9_-]*$/i.test(tier)) {
    throw new Error(`Production plans field "${field}.tier" is not a valid plan identifier.`);
  }
  return {
    tier,
    name: nonEmptyString(raw.name, `${field}.name`),
    priceUsd: finitePrice(raw.priceUsd, `${field}.priceUsd`),
    cadence: nonEmptyString(raw.cadence, `${field}.cadence`),
    priceLabel: nonEmptyString(raw.priceLabel, `${field}.priceLabel`),
    cadenceLabel: nonEmptyString(raw.cadenceLabel, `${field}.cadenceLabel`),
    tagline: nonEmptyString(raw.tagline, `${field}.tagline`),
    highlight: booleanValue(raw.highlight, `${field}.highlight`),
  };
}

function mapFeatures(value: unknown, planTiers: readonly string[]): ProductionPlanFeature[] {
  if (!Array.isArray(value)) {
    throw new Error('Production plans field "features" must be an array.');
  }
  return value.map((entry, index) => {
    const field = `features[${index}]`;
    const raw = objectValue(entry, field);
    const label = normalizeSkipTheLineProductName(
      nonEmptyString(raw.label, `${field}.label`),
    );
    const values: Record<string, ProductionPlanFeatureValue> = {};

    for (const [tier, featureValue] of Object.entries(raw)) {
      if (tier === 'label') continue;
      if (typeof featureValue !== 'boolean' && typeof featureValue !== 'string') {
        throw new Error(`Production plans field "${field}.${tier}" must be a string or boolean.`);
      }
      values[tier] = featureValue;
    }
    for (const tier of planTiers) {
      if (!Object.prototype.hasOwnProperty.call(values, tier)) {
        throw new Error(`Production plans feature "${label}" is missing the "${tier}" value.`);
      }
    }
    return { label, values };
  });
}

function mapCardFeatures(value: unknown, planTiers: readonly string[]): Record<string, string[]> {
  const raw = objectValue(value, 'cardFeatures');
  const mapped: Record<string, string[]> = {};
  for (const tier of planTiers) {
    const entries = raw[tier];
    if (!Array.isArray(entries)) {
      throw new Error(`Production plans field "cardFeatures.${tier}" must be an array.`);
    }
    mapped[tier] = entries.map((entry, index) =>
      normalizeSkipTheLineProductName(
        nonEmptyString(entry, `cardFeatures.${tier}[${index}]`),
      ),
    );
  }
  return mapped;
}

export function mapProductionMembershipPlans(value: unknown): ProductionMembershipPlanCatalog {
  const raw = objectValue(value, 'response');
  if (!Array.isArray(raw.plans)) {
    throw new Error('Production plans response must contain a plans array.');
  }
  const plans = raw.plans.map(mapPlan);
  const tiers = plans.map(({ tier }) => tier);
  if (new Set(tiers).size !== tiers.length) {
    throw new Error('Production plans response contains duplicate plan identifiers.');
  }

  const rawAvailability = objectValue(raw, 'response');
  const availability: ProductionPlanAvailability = {
    signupsEnabled: booleanValue(rawAvailability.signupsEnabled, 'signupsEnabled'),
    charterEnabled: booleanValue(rawAvailability.charterEnabled, 'charterEnabled'),
    buyNowEnabled: booleanValue(rawAvailability.buyNowEnabled, 'buyNowEnabled'),
  };

  return {
    plans,
    features: mapFeatures(raw.features, tiers),
    cardFeatures: mapCardFeatures(raw.cardFeatures, tiers),
    availability,
  };
}

export function formatProductionPlanPrice(plan: ProductionPlan): string {
  return `${plan.priceLabel} ${plan.cadenceLabel}`.trim();
}

export function productionPlanFeatureLabel(value: ProductionPlanFeatureValue): string {
  return typeof value === 'boolean' ? (value ? 'Included' : 'Not included') : value;
}

export function productionPlanPurchaseNotice(
  availability: ProductionPlanAvailability,
): string {
  if (!availability.signupsEnabled) return 'Membership signups are currently unavailable.';
  if (!availability.buyNowEnabled) return 'Membership purchases are currently unavailable.';
  return 'Purchases cannot be completed in this app yet.';
}

export async function fetchProductionMembershipPlans(
  options: ProductionPlanReadOptions = {},
): Promise<ProductionMembershipPlanCatalog> {
  return mapProductionMembershipPlans(
    await fetchProductionJson(MAIN_BLUEBIRD_MEMBERSHIP_PLANS_PATH, options),
  );
}
