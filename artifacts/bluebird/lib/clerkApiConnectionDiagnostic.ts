import {
  ProductionAuthHttpError,
  ProductionAuthConfigurationError,
  ProductionAuthRequestError,
  type ProductionAuthDiagnosticHooks,
  type ProductionCurrentUser,
} from './productionAuthApi';
import {
  validateMainBluebirdApiBaseUrl,
  type MainBluebirdApiConfiguration,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';
import type { ProductionRequestMetadata } from './productionRequestTransport';
export { createAuthenticatedProductionApiClient } from './productionAuthApi';

export type ClerkApiConnectionFailureCategory =
  | 'HTTP'
  | 'browser transport (ambiguous)'
  | 'timeout'
  | 'token'
  | 'cancelled'
  | 'invalid JSON'
  | 'invalid schema'
  | 'URL/configuration'
  | 'client setup'
  | 'confirmation';

export type ClerkApiDiagnosticStageName =
  | 'button'
  | 'confirmation'
  | 'client'
  | 'token'
  | 'fetch';

export type ClerkApiDiagnosticStageStatus =
  | 'not reached'
  | 'clicked'
  | 'waiting'
  | 'accepted'
  | 'declined'
  | 'initialized'
  | 'obtained'
  | 'initiated'
  | 'completed'
  | 'failed';

export interface ClerkApiDiagnosticStage {
  name: ClerkApiDiagnosticStageName;
  status: ClerkApiDiagnosticStageStatus;
  /** The only token information retained by the diagnostic. */
  tokenObtained?: boolean | null;
}

export interface ClerkApiConnectionDiagnosticResult {
  environment: MainBluebirdApiEnvironment;
  /** Credential-free target derived from the validated Development URL. */
  target: { origin: string; path: string } | null;
  clerkSessionExists: boolean;
  tokenObtained: boolean | null;
  fetchInvoked: boolean;
  httpStatus: number | null;
  apiResponseReceived: boolean;
  authenticationAccepted: boolean | null;
  requestMetadata: ClerkApiConnectionRequestMetadata | null;
  failureCategory: ClerkApiConnectionFailureCategory | null;
  stages: ClerkApiDiagnosticStage[];
}

export interface ClerkApiConnectionRequestMetadata extends ProductionRequestMetadata {
  executionPlatform: 'ios' | 'android' | 'web' | 'windows' | 'macos' | 'native' | 'unknown';
}

export interface ClerkApiConnectionClient {
  getMeWithStatus: (
    onResponseStatus?: (status: number) => void,
  ) => Promise<{ status: number; currentUser: ProductionCurrentUser }>;
}

export function getClerkApiConnectionFailureGuidance(
  category: ClerkApiConnectionFailureCategory | null,
): string[] | null {
  if (category === 'browser transport (ambiguous)') {
    return [
      'Fetch was invoked, but the browser exposed no HTTP response or reliable reason for the failure. This does not establish whether the request reached the API.',
      'Check browser DevTools Network and Console and the target API access logs. The checked-in API CORS middleware reflects the request origin and requested headers; confirm the target runs that configuration before changing server settings.',
      'Do not share Authorization headers, tokens, cookies, or response contents.',
    ];
  }
  if (category === 'URL/configuration') {
    return [
      'The resolved API URL did not match the allowed diagnostic endpoint, so no request was sent.',
      'Check the configured Development Main API URL. The candidate URL is not displayed.',
    ];
  }
  return null;
}

export function isClerkApiConnectionTestVisible(input: {
  isDevelopment: boolean;
  environment: MainBluebirdApiEnvironment | null;
  configurationValid: boolean;
  clerkInstanceMatchVerified: boolean;
  clerkAuthEnabled: boolean;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
}): boolean {
  return input.isDevelopment &&
    input.environment === 'development' &&
    input.configurationValid &&
    input.clerkInstanceMatchVerified &&
    input.clerkAuthEnabled &&
    input.isLoaded &&
    input.isSignedIn === true;
}

const INITIAL_STAGES: ClerkApiDiagnosticStage[] = [
  { name: 'button', status: 'not reached' },
  { name: 'confirmation', status: 'not reached' },
  { name: 'client', status: 'not reached' },
  { name: 'token', status: 'not reached', tokenObtained: null },
  { name: 'fetch', status: 'not reached' },
];

function emptyResult(
  stages: ClerkApiDiagnosticStage[],
  failureCategory: ClerkApiConnectionFailureCategory | null = null,
  environment: MainBluebirdApiEnvironment = 'development',
  clerkSessionExists = false,
  httpStatus: number | null = null,
  target: ClerkApiConnectionDiagnosticResult['target'] = null,
  requestMetadata: ClerkApiConnectionRequestMetadata | null = null,
): ClerkApiConnectionDiagnosticResult {
  const tokenStage = stages.find((stage) => stage.name === 'token');
  const fetchStage = stages.find((stage) => stage.name === 'fetch');
  return {
    environment,
    target,
    clerkSessionExists,
    tokenObtained: tokenStage?.tokenObtained ?? null,
    fetchInvoked: fetchStage?.status === 'initiated' ||
      fetchStage?.status === 'completed' ||
      fetchStage?.status === 'failed',
    httpStatus,
    apiResponseReceived: httpStatus !== null,
    authenticationAccepted: null,
    requestMetadata,
    failureCategory,
    stages,
  };
}

export async function runClerkApiConnectionTest(input: {
  isDevelopment: boolean;
  environment: MainBluebirdApiEnvironment | null;
  configuration: MainBluebirdApiConfiguration | null;
  configurationValid: boolean;
  clerkInstanceMatchVerified: boolean;
  clerkAuthEnabled: boolean;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  executionPlatform?: string;
  confirm: (title: string, message: string, confirmLabel: string) => Promise<boolean>;
  createApiClient: (hooks: ProductionAuthDiagnosticHooks) => ClerkApiConnectionClient;
  onStages?: (stages: ClerkApiDiagnosticStage[]) => void;
}): Promise<ClerkApiConnectionDiagnosticResult | null> {
  if (!isClerkApiConnectionTestVisible(input)) return null;

  let expectedUrl: string;
  let target: ClerkApiConnectionDiagnosticResult['target'];
  try {
    if (!input.configuration || input.configuration.environment !== 'development') {
      throw new Error('invalid configuration');
    }
    const apiBaseUrl = validateMainBluebirdApiBaseUrl(input.configuration.apiBaseUrl, 'development');
    expectedUrl = `${apiBaseUrl}/me`;
    const parsedTarget = new URL(expectedUrl);
    target = { origin: parsedTarget.origin, path: parsedTarget.pathname };
  } catch {
    const failedStages = INITIAL_STAGES.map((stage) => ({ ...stage }));
    failedStages[0] = { name: 'button', status: 'clicked' };
    failedStages[2] = { name: 'client', status: 'failed' };
    return emptyResult(
      failedStages,
      'URL/configuration',
      input.environment ?? 'development',
      input.isSignedIn === true,
      null,
      null,
    );
  }

  let stages = INITIAL_STAGES.map((stage) => ({ ...stage }));
  const publishStages = () => {
    try {
      input.onStages?.(stages.map((stage) => ({ ...stage })));
    } catch {
      // Reporting is observational and must not interrupt the diagnostic.
    }
  };
  const updateStage = (
    name: ClerkApiDiagnosticStageName,
    status: ClerkApiDiagnosticStageStatus,
    tokenObtained?: boolean,
  ) => {
    stages = stages.map((stage) =>
      stage.name === name
        ? {
            ...stage,
            status,
            ...(name === 'token' ? { tokenObtained: tokenObtained ?? false } : {}),
          }
        : stage,
    );
    publishStages();
  };

  updateStage('button', 'clicked');
  updateStage('confirmation', 'waiting');
  let confirmed: boolean;
  try {
    confirmed = await input.confirm(
      'Test Bluebird API Connection',
      'This will send one authenticated GET request to the configured Bluebird Development API. The request uses the matching Development Clerk session. Continue?',
      'Send request',
    );
  } catch {
    updateStage('confirmation', 'failed');
    return emptyResult(stages, 'confirmation', input.environment ?? 'development', input.isSignedIn === true, null, target);
  }

  if (!confirmed) {
    updateStage('confirmation', 'declined');
    return emptyResult(stages, null, input.environment ?? 'development', input.isSignedIn === true, null, target);
  }
  updateStage('confirmation', 'accepted');

  let fetchInitiated = false;
  let responseStatus: number | null = null;
  let requestMetadata: ClerkApiConnectionRequestMetadata | null = null;
  let client: ClerkApiConnectionClient;
  const hooks: ProductionAuthDiagnosticHooks = {
    expectedUrl,
    executionPlatform: input.executionPlatform ?? 'unknown',
    onTokenResult: (tokenObtained) =>
      updateStage('token', tokenObtained ? 'obtained' : 'failed', tokenObtained),
    onFetchInitiated: () => {
      fetchInitiated = true;
      updateStage('fetch', 'initiated');
    },
    onFetchCompleted: () => updateStage('fetch', 'completed'),
    onFetchFailed: () => updateStage('fetch', 'failed'),
    onRequestMetadata: (metadata) => {
      requestMetadata = {
        ...metadata,
        executionPlatform: sanitizeExecutionPlatform(input.executionPlatform),
      };
    },
  };

  updateStage('client', 'waiting');
  try {
    client = input.createApiClient(hooks);
    updateStage('client', 'initialized');
  } catch (error) {
    updateStage('client', 'failed');
    return emptyResult(
      stages,
      getSetupFailureCategory(error),
      input.environment ?? 'development',
      input.isSignedIn === true,
      null,
      target,
    );
  }

  try {
    const { status, currentUser } = await client.getMeWithStatus((value) => {
      responseStatus = value;
    });
    return {
      environment: input.environment ?? 'development',
      target,
      clerkSessionExists: input.isSignedIn === true,
      tokenObtained: stages.find((stage) => stage.name === 'token')?.tokenObtained ?? null,
      fetchInvoked: stages.find((stage) => stage.name === 'fetch')?.status !== 'not reached',
      httpStatus: status,
      apiResponseReceived: true,
      authenticationAccepted: currentUser.isAuthenticated,
      requestMetadata,
      failureCategory: null,
      stages,
    };
  } catch (error) {
    return sanitizeDiagnosticFailure(
      error,
      responseStatus,
      stages,
      fetchInitiated,
      input.environment ?? 'development',
      input.isSignedIn === true,
      target,
      requestMetadata,
    );
  }
}

export function sanitizeDiagnosticFailure(
  error: unknown,
  responseStatus: number | null = null,
  stages: ClerkApiDiagnosticStage[] = INITIAL_STAGES.map((stage) => ({ ...stage })),
  fetchInitiated = false,
  environment: MainBluebirdApiEnvironment = 'development',
  clerkSessionExists = false,
  target: ClerkApiConnectionDiagnosticResult['target'] = null,
  requestMetadata: ClerkApiConnectionRequestMetadata | null = null,
): ClerkApiConnectionDiagnosticResult {
  if (error instanceof ProductionAuthHttpError) {
    return {
      ...emptyResult(stages, 'HTTP', environment, clerkSessionExists, error.status, target, requestMetadata),
      authenticationAccepted: error.status === 401 ? false : null,
    };
  }

  const category = getFailureCategory(error, fetchInitiated);
  return emptyResult(stages, category, environment, clerkSessionExists, responseStatus, target, requestMetadata);
}

function sanitizeExecutionPlatform(value: string | undefined): ClerkApiConnectionRequestMetadata['executionPlatform'] {
  switch (value) {
    case 'ios':
    case 'android':
    case 'web':
    case 'windows':
    case 'macos':
    case 'native':
      return value;
    default:
      return 'unknown';
  }
}

function getSetupFailureCategory(error: unknown): 'URL/configuration' | 'client setup' {
  return error instanceof ProductionAuthConfigurationError
    ? 'URL/configuration'
    : 'client setup';
}

function getFailureCategory(
  error: unknown,
  fetchInitiated: boolean,
): ClerkApiConnectionFailureCategory {
  if (!(error instanceof ProductionAuthRequestError)) {
    return fetchInitiated ? 'browser transport (ambiguous)' : 'client setup';
  }
  switch (error.code) {
    case 'token':
      return 'token';
    case 'timeout':
      return 'timeout';
    case 'invalid_json':
      return 'invalid JSON';
    case 'invalid_schema':
      return 'invalid schema';
    case 'network':
      return 'browser transport (ambiguous)';
    case 'cancelled':
      return 'cancelled';
    case 'http':
    case 'session_expired':
      return 'HTTP';
  }
}
