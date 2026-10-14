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
 * Each existing destination has a separate prerequisite. All remain closed:
 * Clerk token acceptance, linked-account ownership, and legacy account-screen
 * compatibility have not been confirmed.
 */
export const CLERK_MEMBER_NAVIGATION_READINESS = {
  linkedMember: false,
  registration: false,
  onboarding: false,
} as const;

export const PRODUCTION_AUTH_UNAVAILABLE_MESSAGE =
  'Authenticated production member data is unavailable. Acceptance of Clerk tokens by the deployed API and mapping to a stable Bluebird member account are unverified; safe profile and member endpoint behavior has not been confirmed.';

export interface ProductionAuthAvailability {
  status: 'unavailable';
  reasons: readonly ProductionAuthAvailabilityReason[];
}
