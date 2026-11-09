import {
  ProductionAuthCancelledError,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
  PRODUCTION_AUTH_TIMEOUT_MS,
} from './productionAuthApi';
import { validateMainBluebirdApiBaseUrl, type MainBluebirdApiEnvironment } from './mainBluebirdApiConfig';
import { requestProductionJson } from './productionRequestTransport';

const SAFE_CODE = /^[a-z0-9_]{1,80}$/i;
const FLIGHT_QUEUE_PATH = '/empty-legs/22655/queue';

export const CONNECTION_DIAGNOSTIC_CHECKS = [
  { id: 'queue-status', label: 'Queue status', path: '/me/connections/queue-status' },
  { id: 'accepted', label: 'Accepted connections', path: '/me/connections' },
  { id: 'incoming', label: 'Incoming requests', path: '/me/connections/requests/incoming' },
  { id: 'blocks', label: 'Blocks', path: '/me/connections/blocks' },
  { id: 'queue', label: 'Flight 22655 queue', path: FLIGHT_QUEUE_PATH },
] as const;

export type ConnectionDiagnosticId = (typeof CONNECTION_DIAGNOSTIC_CHECKS)[number]['id'];

export interface ConnectionDiagnosticResult {
  id: ConnectionDiagnosticId;
  label: string;
  status: number | null;
  valid: boolean;
  count: number | null;
  errorCode: string | null;
  hasConnectionTargetReference: boolean | null;
}

export function assessConnectionDiagnostic(
  id: ConnectionDiagnosticId,
  value: unknown,
): Pick<ConnectionDiagnosticResult, 'valid' | 'count' | 'hasConnectionTargetReference'> {
  if (id === 'queue-status') return assessQueueStatus(value);
  if (id === 'accepted') return assessArray(value, 'connections');
  if (id === 'incoming') return assessArray(value, 'requests');
  if (id === 'blocks') return assessArray(value, 'blocks');
  return assessFlightQueue(value);
}

export async function runConnectionDiagnostics(input: {
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}): Promise<ConnectionDiagnosticResult[]> {
  let baseUrl: string;
  try {
    baseUrl = validateMainBluebirdApiBaseUrl(input.baseUrl, input.environment);
  } catch {
    return CONNECTION_DIAGNOSTIC_CHECKS.map((check) => unavailable(check, 'configuration'));
  }
  const results: ConnectionDiagnosticResult[] = [];
  for (const check of CONNECTION_DIAGNOSTIC_CHECKS) {
    results.push(await readCheck(check, baseUrl, input));
  }
  return results;
}

async function readCheck(
  check: (typeof CONNECTION_DIAGNOSTIC_CHECKS)[number],
  baseUrl: string,
  input: {
    getAccessToken: () => Promise<string | null>;
    fetcher?: typeof fetch;
  },
): Promise<ConnectionDiagnosticResult> {
  let status: number | null = null;
  try {
    const assessed = await requestProductionJson({
      url: `${baseUrl}${check.path}`,
      fetcher: input.fetcher ?? fetch,
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      timeoutMs: PRODUCTION_AUTH_TIMEOUT_MS,
      onResponseStatus: (responseStatus) => {
        status = responseStatus;
      },
      prepareHeaders: async () => {
        let token: string | null;
        try {
          token = await input.getAccessToken();
        } catch {
          throw new ProductionAuthHttpError(0, { code: 'token', body: null });
        }
        if (typeof token !== 'string' || token.trim() === '' || /\s/.test(token)) {
          throw new ProductionAuthHttpError(0, { code: 'token', body: null });
        }
        return { Authorization: `Bearer ${token}` };
      },
      parse: (value) => assessConnectionDiagnostic(check.id, value),
      errors: {
        timeout: (duration) => new ProductionAuthTimeoutError(duration),
        cancelled: () => new ProductionAuthCancelledError(),
        network: () => new ProductionAuthNetworkError(),
        http: async (response) => new ProductionAuthHttpError(response.status, await readSafeFailure(response)),
        invalidJson: () => new ProductionAuthInvalidJsonError(),
        schema: () => new ProductionAuthSchemaError('response'),
      },
    });
    return {
      id: check.id,
      label: check.label,
      status,
      errorCode: null,
      ...assessed,
    };
  } catch (error) {
    return {
      id: check.id,
      label: check.label,
      status: error instanceof ProductionAuthHttpError && error.status > 0 ? error.status : status,
      valid: false,
      count: null,
      errorCode: failureCode(error),
      hasConnectionTargetReference: null,
    };
  }
}

function assessQueueStatus(value: unknown): Pick<ConnectionDiagnosticResult, 'valid' | 'count' | 'hasConnectionTargetReference'> {
  const rows = arrayField(value, 'relationships');
  if (!rows) return { valid: false, count: null, hasConnectionTargetReference: null };
  return {
    valid: rows.every(isQueueRelationship),
    count: rows.length,
    hasConnectionTargetReference: null,
  };
}

function assessArray(
  value: unknown,
  field: 'connections' | 'requests' | 'blocks',
): Pick<ConnectionDiagnosticResult, 'valid' | 'count' | 'hasConnectionTargetReference'> {
  const rows = arrayField(value, field);
  if (!rows) return { valid: false, count: null, hasConnectionTargetReference: null };
  return { valid: true, count: rows.length, hasConnectionTargetReference: null };
}

function assessFlightQueue(value: unknown): Pick<ConnectionDiagnosticResult, 'valid' | 'count' | 'hasConnectionTargetReference'> {
  if (!Array.isArray(value)) return { valid: false, count: null, hasConnectionTargetReference: null };
  return {
    valid: true,
    count: value.length,
    hasConnectionTargetReference: value.some(hasReference),
  };
}

function isQueueRelationship(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return positiveId(row.connectionId) &&
    positiveId(row.emptyLegId) &&
    (row.status === 'pending' || row.status === 'accepted') &&
    (row.direction === 'outgoing' || row.direction === 'incoming') &&
    typeof row.updatedAt === 'string' &&
    Number.isFinite(Date.parse(row.updatedAt));
}

function hasReference(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reference = (value as { connectionTargetReference?: unknown }).connectionTargetReference;
  return typeof reference === 'string' && reference.trim().length > 0;
}

function arrayField(value: unknown, field: string): unknown[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rows = (value as Record<string, unknown>)[field];
  return Array.isArray(rows) ? rows : null;
}

function positiveId(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function unavailable(
  check: (typeof CONNECTION_DIAGNOSTIC_CHECKS)[number],
  errorCode: string,
): ConnectionDiagnosticResult {
  return {
    id: check.id,
    label: check.label,
    status: null,
    valid: false,
    count: null,
    errorCode,
    hasConnectionTargetReference: null,
  };
}

function failureCode(error: unknown): string | null {
  if (error instanceof ProductionAuthHttpError) return safeCode(error.serverCode);
  if (error instanceof ProductionAuthTimeoutError) return 'timeout';
  if (error instanceof ProductionAuthCancelledError) return 'cancelled';
  if (error instanceof ProductionAuthNetworkError) return 'network';
  if (error instanceof ProductionAuthInvalidJsonError || error instanceof ProductionAuthSchemaError) return 'schema';
  return null;
}

function safeCode(value: string | null): string | null {
  return value && SAFE_CODE.test(value) ? value : null;
}

async function readSafeFailure(response: Response): Promise<{ code: string | null; body: null }> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { code: null, body: null };
    return { code: safeCode(typeof (payload as { code?: unknown }).code === 'string' ? (payload as { code: string }).code : null), body: null };
  } catch {
    return { code: null, body: null };
  }
}
