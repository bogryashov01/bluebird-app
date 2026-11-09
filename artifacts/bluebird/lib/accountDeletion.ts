/**
 * Clerk-authenticated account deletion for the Main Bluebird API.
 *
 * Live DELETE /me/account stays off unless EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION
 * is exactly "true" and the native production auth-test gate is off. The client
 * never deletes a Clerk user from the device.
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
export const ACCOUNT_DELETION_PATH = '/me/account';
export const ACCOUNT_DELETION_CONFIRMATION_WORD = 'DELETE';

export type AccountDeletionOutcome =
  | { kind: 'deleted'; deletedAt: string }
  | { kind: 'pending'; deletionId: string; message: string };

export type AccountDeletionFailureCode =
  | 'disabled'
  | 'configuration'
  | 'token'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'network'
  | 'server'
  | 'invalid_response'
  | 'cancelled';

export type AccountDeletionResult =
  | { kind: 'disabled' }
  | { kind: 'loaded'; data: AccountDeletionOutcome }
  | { kind: 'error'; code: AccountDeletionFailureCode; conflictCode: string | null };

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

export function parseAccountDeletionResponse(value: unknown): AccountDeletionOutcome {
  const raw = objectValue(value, 'accountDeletion');
  const status = stringValue(raw.status, 'accountDeletion.status');
  if (status === 'deleted') {
    return {
      kind: 'deleted',
      deletedAt: stringValue(raw.deletedAt, 'accountDeletion.deletedAt'),
    };
  }
  if (status === 'pending') {
    return {
      kind: 'pending',
      deletionId: stringValue(raw.deletionId, 'accountDeletion.deletionId'),
      message: typeof raw.message === 'string' && raw.message.trim()
        ? raw.message.trim()
        : 'Your account deletion is still processing. You stay signed in until it finishes.',
    };
  }
  return schemaFailure('accountDeletion.status');
}

export function presentAccountDeletionFailure(input: {
  code: AccountDeletionFailureCode;
  conflictCode?: string | null;
}): { title: string; body: string; canRetry: boolean } {
  switch (input.code) {
    case 'disabled':
      return {
        title: 'Deletion unavailable',
        body: 'Account deletion is not available in this build yet. Your account was not changed.',
        canRetry: false,
      };
    case 'unauthorized':
    case 'forbidden':
      return {
        title: 'Sign in required',
        body: 'Your session could not authorize account deletion. Sign in again and try once more. Your account was not deleted.',
        canRetry: false,
      };
    case 'conflict': {
      const detail = presentAccountDeletionConflict(input.conflictCode ?? null);
      return {
        title: 'Deletion blocked',
        body: detail,
        canRetry: false,
      };
    }
    case 'network':
      return {
        title: 'Connection problem',
        body: 'Bluebird could not reach the server. Check your connection and try again. Your account was not deleted.',
        canRetry: true,
      };
    case 'server':
      return {
        title: 'Deletion failed',
        body: 'Bluebird could not delete your account right now. Try again later. Your account was not deleted.',
        canRetry: true,
      };
    case 'configuration':
    case 'token':
    case 'invalid_response':
      return {
        title: 'Deletion unavailable',
        body: 'Account deletion could not be completed. Your account was not deleted.',
        canRetry: false,
      };
    case 'cancelled':
      return {
        title: 'Deletion cancelled',
        body: 'The request was cancelled. Your account was not deleted.',
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
    case 'active_trip':
      return 'You have an active trip that must be resolved before Bluebird can delete this account. Your account was not deleted.';
    case 'open_winner_offer':
      return 'You have an open flight offer that must be resolved before deletion. Your account was not deleted.';
    case 'family_primary_has_members':
      return 'This account is the primary Family/Corporate owner for other members. Transfer ownership or remove members before deleting. Your account was not deleted.';
    default:
      return 'Bluebird cannot delete this account right now because of an operational restriction. Your account was not deleted.';
  }
}

async function readDeletionHttpFailure(response: Response): Promise<{ code: string | null; body: unknown }> {
  try {
    const text = await response.text();
    if (!text.trim()) return { code: null, body: null };
    return sanitizeProductionHttpFailure(JSON.parse(text)) ?? { code: null, body: null };
  } catch {
    return { code: null, body: null };
  }
}

function mapDeletionFailure(error: unknown): {
  code: AccountDeletionFailureCode;
  conflictCode: string | null;
} {
  if (error instanceof ProductionAuthHttpError) {
    if (error.status === 401) return { code: 'unauthorized', conflictCode: null };
    if (error.status === 403) return { code: 'forbidden', conflictCode: null };
    if (error.status === 409) {
      return {
        code: 'conflict',
        conflictCode: typeof error.serverCode === 'string' ? error.serverCode : null,
      };
    }
    if (error.status >= 500) return { code: 'server', conflictCode: null };
    return { code: 'server', conflictCode: null };
  }
  if (error instanceof ProductionAuthNetworkError || error instanceof ProductionAuthTimeoutError) {
    return { code: 'network', conflictCode: null };
  }
  if (error instanceof ProductionAuthCancelledError) {
    return { code: 'cancelled', conflictCode: null };
  }
  if (
    error instanceof ProductionAuthRequestError &&
    (error.code === 'token' || error.message.includes('access token'))
  ) {
    return { code: 'token', conflictCode: null };
  }
  if (
    error instanceof ProductionAuthSchemaError ||
    error instanceof ProductionAuthInvalidJsonError ||
    error instanceof TypeError
  ) {
    return { code: 'invalid_response', conflictCode: null };
  }
  return { code: 'server', conflictCode: null };
}

export function createAccountDeletionClient(options: AccountDeletionClientOptions) {
  const live = (options.enabled ?? isAccountDeletionMutationEnabled()) === true
    && (options.nativeAuthTest ?? isNativeProductionAuthTestEnabled()) !== true;

  return {
    isMutationEnabled: live,
    deleteAccount: async (input: {
      confirmation: string;
      signal?: AbortSignal;
    }): Promise<AccountDeletionResult> => {
      if (!live) return { kind: 'disabled' };
      if (!isAccountDeletionConfirmationValid(input.confirmation)) {
        return { kind: 'error', code: 'invalid_response', conflictCode: null };
      }

      let baseUrl: string;
      try {
        baseUrl = validateMainBluebirdApiBaseUrl(options.baseUrl, options.environment);
      } catch {
        return { kind: 'error', code: 'configuration', conflictCode: null };
      }

      try {
        const data = await requestProductionJson({
          url: `${baseUrl}${ACCOUNT_DELETION_PATH}`,
          fetcher: options.fetcher ?? fetch,
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION_WORD }),
          credentials: 'omit',
          timeoutMs: PRODUCTION_AUTH_TIMEOUT_MS,
          signal: input.signal,
          prepareHeaders: async () => {
            let token: string | null;
            try {
              token = await options.getAccessToken();
            } catch {
              throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
            }
            if (typeof token !== 'string' || token.trim() === '' || /\s/.test(token)) {
              throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
            }
            return { Authorization: `Bearer ${token}` };
          },
          parse: parseAccountDeletionResponse,
          errors: {
            timeout: (duration) => new ProductionAuthTimeoutError(duration),
            cancelled: () => new ProductionAuthCancelledError(),
            network: () => new ProductionAuthNetworkError(),
            http: async (response) => new ProductionAuthHttpError(
              response.status,
              await readDeletionHttpFailure(response),
            ),
            invalidJson: () => new ProductionAuthInvalidJsonError(),
            schema: (error) => new ProductionAuthSchemaError(
              error instanceof Error ? error.message : 'response',
            ),
          },
        });
        return { kind: 'loaded', data };
      } catch (error) {
        const mapped = mapDeletionFailure(error);
        return { kind: 'error', code: mapped.code, conflictCode: mapped.conflictCode };
      }
    },
  };
}
