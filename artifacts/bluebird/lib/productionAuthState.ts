export type ProductionAuthAvailabilityReason =
  | 'provider_not_connected'
  | 'backend_token_compatibility_unverified';

/**
 * Production authenticated calls remain disabled until both a verified token
 * provider is integrated and the API server explicitly accepts its tokens.
 * This status is deliberately not inferred from AuthContext's demo session.
 */
export const PRODUCTION_AUTH_AVAILABILITY = {
  status: 'unavailable',
  reasons: [
    'provider_not_connected',
    'backend_token_compatibility_unverified',
  ],
} as const satisfies {
  status: 'unavailable';
  reasons: readonly ProductionAuthAvailabilityReason[];
};

export const PRODUCTION_AUTH_UNAVAILABLE_MESSAGE =
  'Authenticated production data is unavailable. No verified production token provider is connected, and the checked-in API server validates its own JWT_SECRET/SESSION_SECRET-signed tokens; compatibility with Clerk tokens has not been established.';

export interface ProductionAuthAvailability {
  status: 'unavailable';
  reasons: readonly ProductionAuthAvailabilityReason[];
}
