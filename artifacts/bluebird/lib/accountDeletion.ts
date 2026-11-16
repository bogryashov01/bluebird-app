/**
 * Clerk-authenticated account deletion for the Main Bluebird API.
 *
 * Live GET/POST /me/account-deletion stay off unless
 * EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION is exactly "true" and the native
 * production auth-test gate is off. The client never deletes a Clerk user
 * from the device. Strict reverification must complete through Clerk Session
 * verification APIs — ordinary getToken() alone is never treated as enough.
 *
 * TestFlight enablement: `production-live-internal` sets
 * EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION=true. Missing or undeployed Main API
 * endpoints must surface as unavailable errors — never crash the Delete Account
 * screen or treat failures as successful deletion.
 *
 * Contract (Main API, verified):
 * - GET  /me/account-deletion → { enabled, blockers, requiresMembershipCancellationAcknowledgement }
 * - POST /me/account-deletion → { confirmation: "DELETE", acknowledgeMembershipCancellation: boolean }
 * - GET  /me/account-deletion/status → { status: not_requested | pending | completed, ... }
 */
import {
  ProductionAuthCancelledError,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
  PRODUCTION_AUTH_TIMEOUT_MS,
  sanitizeProductionHttpFailure,
} from '@/lib/productionAuthApi';
import { validateMainBluebirdApiBaseUrl } from '@/lib/mainBluebirdApiConfig';
import { isNativeProductionAuthTestEnabled } from '@/lib/nativeAuthTestPolicy';
import { requestProductionJson } from '@/lib/productionRequestTransport';

export const ACCOUNT_DELETION_FLAG = 'EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION';
export const ACCOUNT_DELETION_PATH = '/me/account-deletion';
export const ACCOUNT_DELETION_STATUS_PATH = '/me/account-deletion/status';
export const ACCOUNT_DELETION_CONFIRMATION_WORD = 'DELETE';
export const ACCOUNT_DELETION_REVERIFICATION_REASON = 'reverification-error';

export type AccountDeletionBlocker = { code: string };

export type AccountDeletionEligibility = {
  enabled: boolean;
  blockers: readonly AccountDeletionBlocker[];
  requiresMembershipCancellationAcknowledgement: boolean;
};

export type AccountDeletionOutcome =
  | { kind: 'completed' }
  | {
      kind: 'pending';
      requestId: string;
      retryable: boolean;
      message: string;
    };

export type AccountDeletionStatus =
  | { kind: 'not_requested' }
  | {
      kind: 'pending';
      requestId: string | null;
      retryable: boolean;
      message: string;
    }
  | { kind: 'completed' };

export type AccountDeletionFailureCode =
  | 'disabled'
  | 'configuration'
  | 'token'
  | 'unauthorized'
  | 'forbidden'
  | 'self_service_only'
  | 'invalid_body'
  | 'conflict'
  | 'blocked'
  | 'membership_ack_required'
  | 'locked'
  | 'network'
  | 'server'
  | 'unavailable'
  | 'invalid_response'
  | 'cancelled'
  | 'reverification_cancelled'
  | 'reverification_unavailable';

export type AccountDeletionClerkReverificationHint = {
  clerk_error: {
    type: 'forbidden';
    reason: typeof ACCOUNT_DELETION_REVERIFICATION_REASON;
    metadata?: { reverification?: unknown };
  };
};

export type AccountDeletionResult =
  | { kind: 'disabled' }
  | { kind: 'loaded'; data: AccountDeletionOutcome }
  | { kind: 'needs_reverification'; hint: AccountDeletionClerkReverificationHint }
  | {
      kind: 'error';
      code: AccountDeletionFailureCode;
      conflictCode: string | null;
      retryable: boolean;
    };

export type AccountDeletionEligibilityResult =
  | { kind: 'disabled' }
  | { kind: 'loaded'; data: AccountDeletionEligibility }
  | { kind: 'error'; code: AccountDeletionFailureCode; retryable: boolean };

export type AccountDeletionStatusResult =
  | { kind: 'disabled' }
  | { kind: 'loaded'; data: AccountDeletionStatus }
  | { kind: 'error'; code: AccountDeletionFailureCode; retryable: boolean };

export interface AccountDeletionClientOptions {
  environment: 'development' | 'production';
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  enabled?: boolean;
  nativeAuthTest?: boolean;
  fetcher?: typeof fetch;
}

function schemaFailure(field: string): never {
  throw new TypeError(field);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return schemaFailure(field);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') return schemaFailure(field);
  return value.trim();
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return schemaFailure(field);
  return value;
}

/** True only when the release/dev flag explicitly enables live deletion. */
export function isAccountDeletionMutationEnabled(input?: {
  flag?: string;
  nativeAuthTest?: boolean;
}): boolean {
  const flag = input?.flag ?? process.env.EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION;
  const nativeAuthTest = input?.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  return flag === 'true' && nativeAuthTest !== true;
}

export function isAccountDeletionConfirmationValid(value: string): boolean {
  return value.trim().toUpperCase() === ACCOUNT_DELETION_CONFIRMATION_WORD;
}

/**
 * Eligible only when the backend reports enabled and no blockers.
 * Never treat enabled alone as enough when blockers are present.
 */
export function isAccountDeletionEligible(eligibility: AccountDeletionEligibility): boolean {
  return eligibility.enabled === true && eligibility.blockers.length === 0;
}

export function parseAccountDeletionBlockers(value: unknown): AccountDeletionBlocker[] {
  if (!Array.isArray(value)) return schemaFailure('accountDeletion.blockers');
  const blockers: AccountDeletionBlocker[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && /^[a-z0-9_]{1,80}$/.test(entry)) {
      blockers.push({ code: entry });
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return schemaFailure('accountDeletion.blockers.entry');
    }
    const code = (entry as { code?: unknown }).code;
    if (typeof code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(code)) {
      return schemaFailure('accountDeletion.blockers.code');
    }
    blockers.push({ code });
  }
  return blockers;
}

export function isAccountDeletionReverificationHint(
  value: unknown,
): value is AccountDeletionClerkReverificationHint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const clerkError = (value as { clerk_error?: unknown }).clerk_error;
  if (!clerkError || typeof clerkError !== 'object' || Array.isArray(clerkError)) return false;
  const record = clerkError as Record<string, unknown>;
  return record.type === 'forbidden' && record.reason === ACCOUNT_DELETION_REVERIFICATION_REASON;
}

/**
 * Adapts client results for Clerk's useReverification(): the hook expects the
 * raw clerk_error hint object (not a wrapped needs_reverification envelope).
 */
export function accountDeletionResultForReverification(
  result: AccountDeletionResult,
): AccountDeletionClerkReverificationHint | Exclude<AccountDeletionResult, { kind: 'needs_reverification' }> {
  if (result.kind === 'needs_reverification') return result.hint;
  return result;
}

export function parseAccountDeletionEligibility(value: unknown): AccountDeletionEligibility {
  const raw = objectValue(value, 'accountDeletionEligibility');
  return {
    enabled: booleanValue(raw.enabled, 'accountDeletionEligibility.enabled'),
    blockers: parseAccountDeletionBlockers(raw.blockers),
    requiresMembershipCancellationAcknowledgement: booleanValue(
      raw.requiresMembershipCancellationAcknowledgement,
      'accountDeletionEligibility.requiresMembershipCancellationAcknowledgement',
    ),
  };
}

export function parseAccountDeletionResponse(value: unknown): AccountDeletionOutcome {
  const raw = objectValue(value, 'accountDeletion');
  const status = stringValue(raw.status, 'accountDeletion.status');

  if (status === 'completed' || status === 'deleted') {
    return { kind: 'completed' };
  }

  if (status === 'pending' || status === 'processing') {
    const requestId = typeof raw.requestId === 'string' && raw.requestId.trim()
      ? raw.requestId.trim()
      : typeof raw.deletionId === 'string' && raw.deletionId.trim()
        ? raw.deletionId.trim()
        : schemaFailure('accountDeletion.requestId');
    return {
      kind: 'pending',
      requestId,
      retryable: typeof raw.retryable === 'boolean' ? raw.retryable : false,
      message: typeof raw.message === 'string' && raw.message.trim()
        ? raw.message.trim()
        : typeof raw.supportMessage === 'string' && raw.supportMessage.trim()
          ? raw.supportMessage.trim()
          : 'Your account deletion is still processing. You stay signed in until it finishes.',
    };
  }

  return schemaFailure('accountDeletion.status');
}

export function parseAccountDeletionStatus(value: unknown): AccountDeletionStatus {
  const raw = objectValue(value, 'accountDeletionStatus');
  const status = stringValue(raw.status, 'accountDeletionStatus.status');

  if (status === 'not_requested' || status === 'none') {
    return { kind: 'not_requested' };
  }
  if (status === 'completed' || status === 'deleted') {
    return { kind: 'completed' };
  }
  if (status === 'pending' || status === 'processing') {
    const requestId = typeof raw.requestId === 'string' && raw.requestId.trim()
      ? raw.requestId.trim()
      : typeof raw.deletionId === 'string' && raw.deletionId.trim()
        ? raw.deletionId.trim()
        : null;
    return {
      kind: 'pending',
      requestId,
      retryable: typeof raw.retryable === 'boolean' ? raw.retryable : false,
      message: typeof raw.message === 'string' && raw.message.trim()
        ? raw.message.trim()
        : typeof raw.supportMessage === 'string' && raw.supportMessage.trim()
          ? raw.supportMessage.trim()
          : 'Your account deletion is still processing. You stay signed in until it finishes.',
    };
  }
  return schemaFailure('accountDeletionStatus.status');
}

export function presentAccountDeletionFailure(input: {
  code: AccountDeletionFailureCode;
  conflictCode?: string | null;
  retryable?: boolean;
}): { title: string; body: string; canRetry: boolean } {
  const retryable = input.retryable === true;
  switch (input.code) {
    case 'disabled':
      return {
        title: 'Deletion unavailable',
        body: 'Account deletion is not available in this build yet. Your account was not changed.',
        canRetry: false,
      };
    case 'unauthorized':
      return {
        title: 'Sign in required',
        body: 'Your session couldn’t authorize account deletion. Sign in again and try once more. Your account was not deleted.',
        canRetry: false,
      };
    case 'forbidden':
      return {
        title: 'Deletion unavailable',
        body: 'Bluebird couldn’t authorize account deletion for this session. Your account was not deleted.',
        canRetry: false,
      };
    case 'self_service_only':
      return {
        title: 'Contact Bluebird support',
        body: 'This account cannot be deleted through self-service in the app. Contact Bluebird support. Your account was not deleted.',
        canRetry: false,
      };
    case 'invalid_body':
      return {
        title: 'Confirmation required',
        body: 'Bluebird couldn’t accept this deletion request. Confirm DELETE and any required membership cancellation acknowledgement, then try again. Your account was not deleted.',
        canRetry: true,
      };
    case 'membership_ack_required':
      return {
        title: 'Membership acknowledgement required',
        body: 'Confirm that deleting this account also cancels your Bluebird membership, then try again. Your account was not deleted.',
        canRetry: true,
      };
    case 'locked':
      return {
        title: 'Deletion locked',
        body: 'Account deletion is temporarily locked for this account. Try again later. Your account was not deleted.',
        canRetry: retryable,
      };
    case 'conflict':
    case 'blocked': {
      return {
        title: 'Deletion blocked',
        body: presentAccountDeletionConflict(input.conflictCode ?? null),
        canRetry: false,
      };
    }
    case 'network':
      return {
        title: 'Connection problem',
        body: 'Bluebird couldn’t reach the server. Check your connection and try again. Your account was not deleted.',
        canRetry: true,
      };
    case 'unavailable':
    case 'server':
      return {
        title: 'Deletion unavailable',
        body: 'Bluebird couldn’t process account deletion right now. Try again later. Your account was not deleted.',
        canRetry: retryable || input.code === 'server',
      };
    case 'configuration':
    case 'token':
    case 'invalid_response':
      return {
        title: 'Deletion unavailable',
        body: 'Account deletion couldn’t be completed. Your account was not deleted.',
        canRetry: false,
      };
    case 'cancelled':
    case 'reverification_cancelled':
      return {
        title: 'Deletion cancelled',
        body: 'The request was cancelled. Your account was not deleted.',
        canRetry: true,
      };
    case 'reverification_unavailable':
      return {
        title: 'Verification required',
        body: 'Bluebird couldn’t start phone verification for this sensitive action. Your account was not deleted.',
        canRetry: true,
      };
    default:
      return {
        title: 'Deletion failed',
        body: 'Your account was not deleted.',
        canRetry: true,
      };
  }
}

export function presentAccountDeletionConflict(conflictCode: string | null): string {
  switch (conflictCode) {
    case 'account_deletion_blocked':
      return 'Bluebird cannot delete this account right now because of an operational restriction. Your account was not deleted.';
    case 'active_trip':
      return 'You have an active trip that must be resolved before Bluebird can delete this account. Your account was not deleted.';
    case 'open_winner_offer':
      return 'You have an open flight offer that must be resolved before deletion. Your account was not deleted.';
    case 'family_primary_has_members':
      return 'This account is the primary Family/Corporate owner for other members. Transfer ownership or remove members before deleting. Your account was not deleted.';
    case 'billing_active':
    case 'billing_blocker':
      return 'An active billing or membership restriction is blocking deletion. Resolve billing on the Bluebird website, then try again. Your account was not deleted.';
    case 'retention_hold':
      return 'A retention or compliance hold is blocking deletion right now. Your account was not deleted.';
    case 'membership_cancellation_confirmation_required':
      return 'Confirm membership cancellation before Bluebird can delete this account. Your account was not deleted.';
    default:
      return 'Bluebird cannot delete this account right now because of an operational restriction. Your account was not deleted.';
  }
}

async function readDeletionHttpBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapDeletionFailure(error: unknown): {
  code: AccountDeletionFailureCode;
  conflictCode: string | null;
  retryable: boolean;
} {
  if (error instanceof ProductionAuthHttpError) {
    const serverCode = typeof error.serverCode === 'string' ? error.serverCode : null;
    if (error.status === 401) return { code: 'unauthorized', conflictCode: null, retryable: false };
    if (error.status === 400 || serverCode === 'invalid_body') {
      return { code: 'invalid_body', conflictCode: serverCode, retryable: true };
    }
    if (error.status === 403) {
      if (serverCode === 'self_service_only') {
        return { code: 'self_service_only', conflictCode: serverCode, retryable: false };
      }
      return { code: 'forbidden', conflictCode: serverCode, retryable: false };
    }
    if (error.status === 423) {
      return { code: 'locked', conflictCode: serverCode, retryable: false };
    }
    if (error.status === 409) {
      if (serverCode === 'membership_cancellation_confirmation_required') {
        return { code: 'membership_ack_required', conflictCode: serverCode, retryable: true };
      }
      return {
        code: 'conflict',
        conflictCode: serverCode ?? 'account_deletion_blocked',
        retryable: false,
      };
    }
    if (error.status === 422) {
      return {
        code: 'blocked',
        conflictCode: serverCode,
        retryable: false,
      };
    }
    if (error.status === 404 || error.status === 501 || serverCode === 'not_found') {
      // Undeployed or not-yet-published Main API routes stay non-fatal.
      return { code: 'unavailable', conflictCode: serverCode, retryable: false };
    }
    if (error.status === 503) {
      return { code: 'unavailable', conflictCode: serverCode, retryable: true };
    }
    if (error.status >= 500) return { code: 'server', conflictCode: serverCode, retryable: true };
    return { code: 'server', conflictCode: serverCode, retryable: false };
  }
  if (error instanceof ProductionAuthNetworkError || error instanceof ProductionAuthTimeoutError) {
    return { code: 'network', conflictCode: null, retryable: true };
  }
  if (error instanceof ProductionAuthCancelledError) {
    return { code: 'cancelled', conflictCode: null, retryable: true };
  }
  if (
    error instanceof ProductionAuthRequestError &&
    (error.code === 'token' || error.message.includes('access token'))
  ) {
    return { code: 'token', conflictCode: null, retryable: false };
  }
  if (
    error instanceof ProductionAuthSchemaError ||
    error instanceof ProductionAuthInvalidJsonError ||
    error instanceof TypeError
  ) {
    return { code: 'invalid_response', conflictCode: null, retryable: false };
  }
  return { code: 'server', conflictCode: null, retryable: true };
}

async function authorizedJson<T>(input: {
  options: AccountDeletionClientOptions;
  path: string;
  method: 'GET' | 'POST';
  body?: string;
  signal?: AbortSignal;
  parse: (value: unknown) => T;
  allowReverificationHint?: boolean;
}): Promise<
  | { kind: 'loaded'; data: T }
  | { kind: 'needs_reverification'; hint: AccountDeletionClerkReverificationHint }
  | {
      kind: 'error';
      code: AccountDeletionFailureCode;
      conflictCode: string | null;
      retryable: boolean;
    }
> {
  let baseUrl: string;
  try {
    baseUrl = validateMainBluebirdApiBaseUrl(input.options.baseUrl, input.options.environment);
  } catch {
    return { kind: 'error', code: 'configuration', conflictCode: null, retryable: false };
  }

  try {
    const data = await requestProductionJson({
      url: `${baseUrl}${input.path}`,
      fetcher: input.options.fetcher ?? fetch,
      method: input.method,
      headers: {
        Accept: 'application/json',
        ...(input.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: input.body,
      credentials: 'omit',
      timeoutMs: PRODUCTION_AUTH_TIMEOUT_MS,
      signal: input.signal,
      prepareHeaders: async () => {
        let token: string | null;
        try {
          token = await input.options.getAccessToken();
        } catch {
          throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
        }
        if (typeof token !== 'string' || token.trim() === '' || /\s/.test(token)) {
          throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
        }
        return { Authorization: `Bearer ${token}` };
      },
      parse: input.parse,
      errors: {
        timeout: (duration) => new ProductionAuthTimeoutError(duration),
        cancelled: () => new ProductionAuthCancelledError(),
        network: () => new ProductionAuthNetworkError(),
        http: async (response) => {
          const rawBody = await readDeletionHttpBody(response);
          if (
            input.allowReverificationHint === true
            && response.status === 403
            && isAccountDeletionReverificationHint(rawBody)
          ) {
            return new ProductionAuthHttpError(403, {
              code: 'session_reverification_required',
              body: rawBody,
            });
          }
          const sanitized = sanitizeProductionHttpFailure(rawBody);
          return new ProductionAuthHttpError(
            response.status,
            sanitized ?? { code: null, body: null },
          );
        },
        invalidJson: () => new ProductionAuthInvalidJsonError(),
        schema: (error) => new ProductionAuthSchemaError(
          error instanceof Error ? error.message : 'response',
        ),
      },
    });
    return { kind: 'loaded', data };
  } catch (error) {
    if (
      input.allowReverificationHint === true
      && error instanceof ProductionAuthHttpError
      && error.status === 403
      && isAccountDeletionReverificationHint(error.failureBody)
    ) {
      return {
        kind: 'needs_reverification',
        hint: error.failureBody,
      };
    }
    const mapped = mapDeletionFailure(error);
    return {
      kind: 'error',
      code: mapped.code,
      conflictCode: mapped.conflictCode,
      retryable: mapped.retryable,
    };
  }
}

export function createAccountDeletionClient(options: AccountDeletionClientOptions) {
  const live = (options.enabled ?? isAccountDeletionMutationEnabled()) === true
    && (options.nativeAuthTest ?? isNativeProductionAuthTestEnabled()) !== true;

  return {
    isMutationEnabled: live,
    getEligibility: async (input: {
      signal?: AbortSignal;
    } = {}): Promise<AccountDeletionEligibilityResult> => {
      if (!live) return { kind: 'disabled' };
      const result = await authorizedJson({
        options,
        path: ACCOUNT_DELETION_PATH,
        method: 'GET',
        signal: input.signal,
        parse: parseAccountDeletionEligibility,
      });
      if (result.kind === 'needs_reverification') {
        return { kind: 'error', code: 'forbidden', retryable: false };
      }
      if (result.kind === 'loaded') return { kind: 'loaded', data: result.data };
      return { kind: 'error', code: result.code, retryable: result.retryable };
    },
    getStatus: async (input: {
      signal?: AbortSignal;
    } = {}): Promise<AccountDeletionStatusResult> => {
      if (!live) return { kind: 'disabled' };
      const result = await authorizedJson({
        options,
        path: ACCOUNT_DELETION_STATUS_PATH,
        method: 'GET',
        signal: input.signal,
        parse: parseAccountDeletionStatus,
      });
      if (result.kind === 'needs_reverification') {
        return { kind: 'error', code: 'forbidden', retryable: false };
      }
      if (result.kind === 'loaded') return { kind: 'loaded', data: result.data };
      return { kind: 'error', code: result.code, retryable: result.retryable };
    },
    /**
     * Submits POST /me/account-deletion with only the required body fields.
     * When the Main API returns Clerk's reverification hint, this resolves with
     * needs_reverification so the caller can complete Session phone OTP and
     * retry — never by treating a cached getToken() as sufficient by itself.
     * Callers must not auto-retry destructive POSTs except through Clerk
     * reverification completion or an explicit user action when retryable.
     */
    deleteAccount: async (input: {
      confirmation: string;
      acknowledgeMembershipCancellation: boolean;
      signal?: AbortSignal;
    }): Promise<AccountDeletionResult> => {
      if (!live) return { kind: 'disabled' };
      if (!isAccountDeletionConfirmationValid(input.confirmation)) {
        return { kind: 'error', code: 'invalid_body', conflictCode: null, retryable: true };
      }
      if (typeof input.acknowledgeMembershipCancellation !== 'boolean') {
        return { kind: 'error', code: 'invalid_body', conflictCode: null, retryable: true };
      }
      return authorizedJson({
        options,
        path: ACCOUNT_DELETION_PATH,
        method: 'POST',
        body: JSON.stringify({
          confirmation: ACCOUNT_DELETION_CONFIRMATION_WORD,
          acknowledgeMembershipCancellation: input.acknowledgeMembershipCancellation,
        }),
        signal: input.signal,
        parse: parseAccountDeletionResponse,
        allowReverificationHint: true,
      });
    },
  };
}
