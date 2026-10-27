export const CLERK_STARTUP_TIMEOUT_MS = 15_000;

export type ClerkStartupState = 'loading' | 'ready' | 'failed';
export type ClerkStartupFailureReason =
  | 'configuration_invalid'
  | 'provider_missing'
  | 'initialization_timeout';

export function getClerkStartupState(input: {
  authExpected: boolean;
  configurationValid?: boolean;
  providerMounted: boolean;
  isLoaded: boolean;
  timedOut: boolean;
}): ClerkStartupState {
  if (!input.authExpected) return 'ready';
  if (input.configurationValid === false || !input.providerMounted) return 'failed';
  if (input.isLoaded) return 'ready';
  return input.timedOut ? 'failed' : 'loading';
}

export function getClerkStartupFailureReason(input: {
  configurationValid?: boolean;
  providerMounted: boolean;
  timedOut: boolean;
}): ClerkStartupFailureReason | null {
  if (input.configurationValid === false) return 'configuration_invalid';
  if (!input.providerMounted) return 'provider_missing';
  if (input.timedOut) return 'initialization_timeout';
  return null;
}

export function getNextClerkStartupAttempt(attempt: number): number {
  return attempt + 1;
}

export function startClerkStartupTimeout(
  onTimeout: () => void,
  timeoutMs = CLERK_STARTUP_TIMEOUT_MS,
): () => void {
  const timeoutId = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timeoutId);
}

export type ClerkStartupDiagnosticEvent =
  | 'production_mode'
  | 'provider_mount'
  | 'initialization_start'
  | 'readiness_change'
  | 'timeout'
  | 'initialization_error'
  | 'signed_in_session'
  | 'sign_in_completed'
  | 'sign_up_completed'
  | 'signed_in_route_requested'
  | 'signed_in_route_reached'
  | 'signed_in_route_failed';

export type ClerkStartupErrorCategory =
  | 'clerk'
  | 'network'
  | 'timeout'
  | 'unknown';

export function sanitizeClerkStartupError(error: unknown): ClerkStartupErrorCategory {
  if (!(error instanceof Error)) return 'unknown';
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout';
  if (error.name === 'NetworkError' || error.name === 'TypeError') return 'network';
  if (error.name === 'ClerkError') return 'clerk';
  return 'unknown';
}

/**
 * Startup logs deliberately contain only a fixed event name and safe booleans,
 * counters, and broad error categories. Never pass SDK messages or identities.
 */
export function logClerkStartupDiagnostic(input: {
  event: ClerkStartupDiagnosticEvent;
  production: boolean;
  attempt?: number;
  providerMounted?: boolean;
  isLoaded?: boolean;
  isSignedIn?: boolean;
  errorCategory?: ClerkStartupErrorCategory;
}) {
  const entry = {
    source: 'bluebird_clerk_startup',
    event: input.event,
    production: input.production,
    ...(typeof input.attempt === 'number' && Number.isSafeInteger(input.attempt) && input.attempt >= 0
      ? { attempt: input.attempt }
      : {}),
    ...(typeof input.providerMounted === 'boolean' ? { providerMounted: input.providerMounted } : {}),
    ...(typeof input.isLoaded === 'boolean' ? { isLoaded: input.isLoaded } : {}),
    ...(typeof input.isSignedIn === 'boolean' ? { isSignedIn: input.isSignedIn } : {}),
    ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
  };
  const output = input.event === 'timeout' ||
    input.event === 'initialization_error' ||
    input.event === 'signed_in_route_failed'
    ? console.warn
    : console.info;
  output('[Bluebird auth startup]', entry);
}
