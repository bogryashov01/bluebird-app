import {
  PRODUCTION_API_BASE_URL,
  resolveFlightReadConfiguration,
} from './productionFlights';
import type {
  BackendAuthState,
  ProductionMeAccount,
} from './productionAuthState';

export const PRODUCTION_ME_PATH = '/me';
export const PRODUCTION_AUTH_TIMEOUT_MS = 10_000;

export interface ProductionAuthApiOptions {
  getToken: () => Promise<string | null>;
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

function invalidResponse(): BackendAuthState {
  return { status: 'network_error', reason: 'invalid_response' };
}

function parseMeResponse(value: unknown): BackendAuthState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidResponse();
  }

  const response = value as Record<string, unknown>;
  if (response.isAuthenticated === false) {
    return { status: 'backend_signed_out' };
  }
  if (response.isAuthenticated !== true) {
    return invalidResponse();
  }

  const account: ProductionMeAccount = {};
  const booleanFields = [
    'isAdmin',
    'isConcierge',
    'isMember',
    'isProfileComplete',
    'needsPlanDecision',
    'needsSignupPhone',
  ] as const;

  for (const field of booleanFields) {
    if (response[field] === undefined) continue;
    if (typeof response[field] !== 'boolean') return invalidResponse();
    account[field] = response[field];
  }

  if (response.memberTier !== undefined) {
    if (response.memberTier !== null && typeof response.memberTier !== 'string') {
      return invalidResponse();
    }
    account.memberTier = response.memberTier;
  }

  return { status: 'authenticated', account };
}

/**
 * Creates an opt-in, production-only API client. Constructing the client does
 * not read a token or make a request; callers must explicitly invoke getMe().
 */
export function createAuthenticatedProductionApiClient(
  options: ProductionAuthApiOptions,
): { getMe: () => Promise<BackendAuthState> } {
  if (typeof options.getToken !== 'function') {
    throw new TypeError('A production auth token getter is required.');
  }

  const timeoutMs = options.timeoutMs ?? PRODUCTION_AUTH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Production auth timeout must be a positive finite number.');
  }

  const baseUrl = resolveFlightReadConfiguration({
    isDev: false,
    mode: 'production',
    baseUrl:
      options.baseUrl ??
      process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_API_BASE_URL ??
      PRODUCTION_API_BASE_URL,
  }).baseUrl;
  const url = `${baseUrl}${PRODUCTION_ME_PATH}`;
  const fetcher = options.fetcher ?? fetch;

  return {
    async getMe(): Promise<BackendAuthState> {
      let providedToken: string | null;
      try {
        providedToken = await options.getToken();
      } catch {
        return { status: 'network_error', reason: 'token' };
      }

      if (providedToken === null) {
        return { status: 'backend_signed_out' };
      }
      if (typeof providedToken !== 'string') {
        return { status: 'network_error', reason: 'token' };
      }

      const token = providedToken.trim();
      if (!token) {
        return { status: 'backend_signed_out' };
      }
      if (/\s/.test(token)) {
        return { status: 'network_error', reason: 'token' };
      }

      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutResult = new Promise<BackendAuthState>((resolve) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          resolve({ status: 'network_error', reason: 'timeout' });
        }, timeoutMs);
      });

      const request = (async (): Promise<BackendAuthState> => {
        let response: Response;
        try {
          response = await fetcher(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            credentials: 'omit',
            signal: controller.signal,
          });
        } catch {
          return { status: 'network_error', reason: 'network' };
        }

        if (response.status === 401) {
          return { status: 'session_expired' };
        }
        if (!response.ok) {
          return {
            status: 'network_error',
            reason: 'http',
            httpStatus: response.status,
          };
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return invalidResponse();
        }
        return parseMeResponse(body);
      })();

      try {
        return await Promise.race([request, timeoutResult]);
      } catch {
        return { status: 'network_error', reason: 'network' };
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    },
  };
}
