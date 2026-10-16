/**
 * Evidence recorded in QUEUE-API-CONTRACT-VERIFICATION.md. These values are
 * intentionally not environment-controlled: only an evidence review and code
 * change may mark a prerequisite verified.
 */
export const PRODUCTION_QUEUE_VERIFICATION = Object.freeze({
  deployedEndpointContract: false,
  mainApiClerkPairing: false,
  serverClerkTokenValidation: false,
  stableMemberIdentityMapping: false,
  trustedSkipLineCreditSource: false,
});

export function isProductionQueueVerified(): boolean {
  return Object.values(PRODUCTION_QUEUE_VERIFICATION).every(Boolean);
}

export function getProductionQueueVerificationBlockers(): string[] {
  const blockers: string[] = [];
  if (!PRODUCTION_QUEUE_VERIFICATION.deployedEndpointContract) {
    blockers.push('the API owner has not verified the deployed per-flight queue endpoints and exact request/response contract');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.mainApiClerkPairing) {
    blockers.push('the selected Main API and Clerk issuer pairing is unverified');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.serverClerkTokenValidation) {
    blockers.push('server-side Clerk token validation is unverified');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.stableMemberIdentityMapping) {
    blockers.push('stable Clerk-to-Bluebird-member identity mapping is unverified');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.trustedSkipLineCreditSource) {
    blockers.push('the trusted source of an existing Skip the Line credit balance is unverified');
  }
  return blockers;
}

export function getProductionQueueReadOnlyMessage(): string {
  const blockers = getProductionQueueVerificationBlockers();
  return [
    'Queue reads and actions remain disabled until verification is complete:',
    ...blockers.map((blocker) => ` ${blocker}.`),
    ' The checked-in API only documents legacy app-JWT queue routes; no fallback is used.',
  ].join('');
}
