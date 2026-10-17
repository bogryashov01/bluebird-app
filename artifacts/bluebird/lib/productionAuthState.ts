export type ProductionAuthAvailabilityReason =
  | 'clerk_token_acceptance_unverified'
  | 'member_identity_mapping_unverified';

/**
 * Production member-data calls remain disabled until the API accepts Clerk
 * tokens and resolves them to an authoritative Bluebird member identity.
 * This status is deliberately not inferred from AuthContext's demo session.
 */
export const PRODUCTION_AUTH_AVAILABILITY = {
  status: 'unavailable',
  reasons: [
    'clerk_token_acceptance_unverified',
    'member_identity_mapping_unverified',
  ],
} as const satisfies {
  status: 'unavailable';
  reasons: readonly ProductionAuthAvailabilityReason[];
};

/**
 * Readiness for legacy semantic registration outcomes. Current /api/me
 * profile-completion routing is handled separately and grants Home only.
 * Member-only routes remain closed until their own safe capability is confirmed.
 */
export const CLERK_MEMBER_NAVIGATION_READINESS = {
  // A registered status may open Home, not member-only operations.
  registeredHome: true,
  linkedMember: false,
} as const;

export const PRODUCTION_AUTH_UNAVAILABLE_MESSAGE =
  'Member information is unavailable right now.';

export interface ProductionAuthAvailability {
  status: 'unavailable';
  reasons: readonly ProductionAuthAvailabilityReason[];
}
