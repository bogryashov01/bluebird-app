/**
 * Clerk push-token registration for POST and DELETE /me/push-tokens.
 *
 * The body is only the Expo token. Clerk identifies the member. A failed or
 * missing endpoint returns unavailable and never throws to sign-in, messaging,
 * or navigation. Tokens and session JWTs are not written to logs.
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
} from './productionAuthApi';
import { requestProductionJson } from './productionRequestTransport';
import {
  validateMainBluebirdApiBaseUrl,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';
import { isNativeProductionAuthTestEnabled } from './nativeAuthTestPolicy';
import {
  acceptRetrievedPushToken,
  CLERK_PUSH_TOKEN_PATH,
} from './clerkPushNotifications';

export type ClerkPushTokenResult =
  | { kind: 'disabled' }
  | { kind: 'registered' }
  | { kind: 'revoked' }
  | { kind: 'invalid-token' }
  | { kind: 'unavailable' };

export interface ClerkPushTokenRequest {
  enabled: boolean;
  nativeAuthTest?: boolean;
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  token: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}

export function parsePushTokenAck(value: unknown, field: 'registered' | 'revoked'): true {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('push-token');
  }
  if ((value as Record<string, unknown>)[field] !== true) throw new Error('push-token');
  return true;
}

async function submitClerkPushToken(
  input: ClerkPushTokenRequest,
  action: 'register' | 'revoke',
): Promise<ClerkPushTokenResult> {
  const nativeAuthTest = input.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  if (input.enabled !== true || nativeAuthTest) return { kind: 'disabled' };
  const accepted = acceptRetrievedPushToken(input.token);
  if (!accepted) return { kind: 'invalid-token' };
  let baseUrl: string;
  try {
    baseUrl = validateMainBluebirdApiBaseUrl(input.baseUrl, input.environment);
  } catch {
    return { kind: 'unavailable' };
  }
  const field = action === 'register' ? 'registered' : 'revoked';
  try {
    await requestProductionJson({
      url: `${baseUrl}${CLERK_PUSH_TOKEN_PATH}`,
      fetcher: input.fetcher ?? fetch,
      method: action === 'register' ? 'POST' : 'DELETE',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: accepted }),
      credentials: 'omit',
      timeoutMs: PRODUCTION_AUTH_TIMEOUT_MS,
      prepareHeaders: async () => {
        let accessToken: string | null;
        try {
          accessToken = await input.getAccessToken();
        } catch {
          throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
        }
        if (typeof accessToken !== 'string' || accessToken.trim() === '' || /\s/.test(accessToken)) {
          throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
        }
        return { Authorization: `Bearer ${accessToken}` };
      },
      parse: (value) => parsePushTokenAck(value, field),
      errors: {
        timeout: (duration) => new ProductionAuthTimeoutError(duration),
        cancelled: () => new ProductionAuthCancelledError(),
        network: () => new ProductionAuthNetworkError(),
        http: (response) => new ProductionAuthHttpError(response.status),
        invalidJson: () => new ProductionAuthInvalidJsonError(),
        schema: () => new ProductionAuthSchemaError('push-token'),
      },
    });
    return { kind: field };
  } catch {
    return { kind: 'unavailable' };
  }
}

export function registerClerkPushToken(input: ClerkPushTokenRequest): Promise<ClerkPushTokenResult> {
  return submitClerkPushToken(input, 'register');
}

export function revokeClerkPushToken(input: ClerkPushTokenRequest): Promise<ClerkPushTokenResult> {
  return submitClerkPushToken(input, 'revoke');
}
