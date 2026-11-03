/**
 * Confirms a versioned push destination with the signed-in Clerk session.
 *
 * The payload id is only a lookup key. Navigation waits until the current
 * account's authenticated read succeeds. A legacy notification that already
 * matched a session id uses kind "session" and does not make another request.
 */

import {
  validateMainBluebirdApiBaseUrl,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';
import { isNativeProductionAuthTestEnabled } from './nativeAuthTestPolicy';
import {
  ProductionAuthCancelledError,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
  PRODUCTION_AUTH_TIMEOUT_MS,
} from './productionAuthApi';
import { requestProductionJson } from './productionRequestTransport';
import { mapProductionFlight } from './productionFlights';
import {
  createMemberMessagesClient,
  isMemberMessagesIntegrationEnabled,
} from './memberMessages';
import {
  createMemberConnectionsClient,
  isMemberConnectionsIntegrationEnabled,
} from './memberConnections';
import type { ClerkPushAccountCheck } from './clerkPushNotifications';

export interface ClerkPushDestinationRequest {
  check: ClerkPushAccountCheck;
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
  nativeAuthTest?: boolean;
  messagesEnabled?: boolean;
  connectionsEnabled?: boolean;
}

async function bearer(getAccessToken: () => Promise<string | null>): Promise<string | null> {
  try {
    const accessToken = await getAccessToken();
    if (typeof accessToken !== 'string' || accessToken.trim() === '' || /\s/.test(accessToken)) return null;
    return accessToken;
  } catch {
    return null;
  }
}

async function readJson(input: {
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  path: string;
  accessToken: string;
  fetcher?: typeof fetch;
}): Promise<unknown | null> {
  try {
    const baseUrl = validateMainBluebirdApiBaseUrl(input.baseUrl, input.environment);
    return await requestProductionJson({
      url: `${baseUrl}${input.path}`,
      fetcher: input.fetcher ?? fetch,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.accessToken}`,
      },
      credentials: 'omit',
      timeoutMs: PRODUCTION_AUTH_TIMEOUT_MS,
      parse: (value) => value,
      errors: {
        timeout: (duration) => new ProductionAuthTimeoutError(duration),
        cancelled: () => new ProductionAuthCancelledError(),
        network: () => new ProductionAuthNetworkError(),
        http: (response) => new ProductionAuthHttpError(response.status),
        invalidJson: () => new ProductionAuthInvalidJsonError(),
        schema: () => new ProductionAuthSchemaError('push-destination'),
      },
    });
  } catch {
    return null;
  }
}

function flightMatches(value: unknown, flightId: number): boolean {
  try {
    return mapProductionFlight(value).id === String(flightId);
  } catch {
    return false;
  }
}

function winnerOwnsFlight(value: unknown, flightId: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const trip = value as { leg?: { id?: unknown }; checklist?: { emptyLegId?: unknown } };
  return trip.leg?.id === flightId || trip.checklist?.emptyLegId === flightId;
}

export async function confirmClerkPushDestination(input: ClerkPushDestinationRequest): Promise<boolean> {
  if (input.check.kind === 'session') return true;
  const nativeAuthTest = input.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  if (nativeAuthTest) return false;
  const accessToken = await bearer(input.getAccessToken);
  if (!accessToken) return false;

  if (input.check.kind === 'conversation') {
    const enabled = input.messagesEnabled ?? isMemberMessagesIntegrationEnabled({ nativeAuthTest });
    if (enabled !== true) return false;
    const client = createMemberMessagesClient({
      enabled: true,
      nativeAuthTest: false,
      environment: input.environment,
      baseUrl: input.baseUrl,
      getAccessToken: async () => accessToken,
      fetcher: input.fetcher,
    });
    const conversationId = input.check.conversationId;
    const history = await client.history({ conversationId, limit: 1 });
    if (history.kind !== 'loaded') return false;
    return history.data.messages.every((message) => message.conversationId === conversationId);
  }

  if (input.check.kind === 'connection') {
    const enabled = input.connectionsEnabled ?? isMemberConnectionsIntegrationEnabled({ nativeAuthTest });
    if (enabled !== true) return false;
    const client = createMemberConnectionsClient({
      enabled: true,
      nativeAuthTest: false,
      environment: input.environment,
      baseUrl: input.baseUrl,
      getAccessToken: async () => accessToken,
      fetcher: input.fetcher,
    });
    const connectionId = input.check.connectionId;
    const [incoming, accepted] = await Promise.all([
      client.listIncoming(),
      client.listAccepted(),
    ]);
    const inIncoming = incoming.kind === 'loaded' &&
      incoming.data.requests.some((request) => request.id === connectionId);
    const inAccepted = accepted.kind === 'loaded' &&
      accepted.data.connections.some((connection) => connection.id === connectionId);
    return inIncoming || inAccepted;
  }

  if (input.check.kind === 'flight') {
    const flight = await readJson({
      environment: input.environment,
      baseUrl: input.baseUrl,
      path: `/empty-legs/${input.check.flightId}`,
      accessToken,
      fetcher: input.fetcher,
    });
    return flightMatches(flight, input.check.flightId);
  }

  const trip = await readJson({
    environment: input.environment,
    baseUrl: input.baseUrl,
    path: `/trips/${input.check.flightId}`,
    accessToken,
    fetcher: input.fetcher,
  });
  return winnerOwnsFlight(trip, input.check.flightId);
}
