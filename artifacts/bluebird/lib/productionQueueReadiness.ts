/**
 * The supplied read-only Main-source audit verifies these source facts. They
 * do not establish that the audited service is deployed or accepts requests.
 */
export const MAIN_SOURCE_QUEUE_EVIDENCE = Object.freeze({
  perFlightRoutes: true,
  clerkBearerHandling: true,
  clerkUserToMemberMapping: true,
});

/**
 * Runtime prerequisites recorded in QUEUE-API-CONTRACT-VERIFICATION.md. These
 * values are intentionally not environment-controlled: configuration shape,
 * client types, or source evidence alone cannot enable queue traffic.
 */
export const PRODUCTION_QUEUE_VERIFICATION = Object.freeze({
  deployedMainService: false,
  deployedRequestResponseCompatibility: false,
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
  if (!PRODUCTION_QUEUE_VERIFICATION.deployedMainService) {
    blockers.push('deployment of the Main service covered by the source audit is unverified');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.deployedRequestResponseCompatibility) {
    blockers.push('exact deployed request/response compatibility with the Mobile client is unverified');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.mainApiClerkPairing) {
    blockers.push('the selected Main API and Clerk issuer pairing is unverified');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.serverClerkTokenValidation) {
    blockers.push('live server acceptance and validation of Clerk Bearer tokens is unverified');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.stableMemberIdentityMapping) {
    blockers.push('runtime resolution of the Clerk user to the intended Bluebird member is unverified');
  }
  if (!PRODUCTION_QUEUE_VERIFICATION.trustedSkipLineCreditSource) {
    blockers.push('the trusted source of an existing Skip the Line credit balance is unverified');
  }
  return blockers;
}

export function getProductionQueueReadOnlyMessage(): string {
  return 'Queue is temporarily unavailable. Please try again later.';
}
