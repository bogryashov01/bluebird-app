import {
  ProductionAuthHttpError,
  ProductionAuthConfigurationError,
  ProductionAuthRequestError,
  type ProductionAuthDiagnosticHooks,
  type ProductionCurrentUser,
} from './productionAuthApi';
import type { MainBluebirdApiEnvironment } from './mainBluebirdApiConfig';
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
  httpStatus: number | null;
  authenticationAccepted: boolean | null;
  isAuthenticated: boolean | null;
  isMember: boolean | null;
  isProfileComplete: boolean | null;
  schemaStatus: 'valid' | 'invalid' | 'not checked';
  failureCategory: ClerkApiConnectionFailureCategory | null;
  stages: ClerkApiDiagnosticStage[];
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
      'The browser did not expose why Fetch failed. It may be CORS/preflight, DNS, TLS, or another network failure.',
      'Check browser DevTools Network and Console for details. Do not share Authorization headers or response contents.',
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
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
}): boolean {
  return input.isDevelopment &&
    input.environment === 'development' &&
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
): ClerkApiConnectionDiagnosticResult {
  return {
    httpStatus: null,
    authenticationAccepted: null,
    isAuthenticated: null,
    isMember: null,
    isProfileComplete: null,
    schemaStatus: 'not checked',
    failureCategory,
    stages,
  };
}

export async function runClerkApiConnectionTest(input: {
  isDevelopment: boolean;
  environment: MainBluebirdApiEnvironment | null;
  targetUrl: string | null;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  confirm: (title: string, message: string, confirmLabel: string) => Promise<boolean>;
  createApiClient: (hooks: ProductionAuthDiagnosticHooks) => ClerkApiConnectionClient;
  onStages?: (stages: ClerkApiDiagnosticStage[]) => void;
}): Promise<ClerkApiConnectionDiagnosticResult | null> {
  if (!isClerkApiConnectionTestVisible(input)) return null;

  let expectedUrl: string;
  try {
    const parsed = new URL(input.targetUrl ?? '');
    if (
      parsed.protocol !== 'https:' ||
      parsed.pathname.replace(/\/+$/, '') !== '/api/me' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password ||
      parsed.origin === 'https://bluebirdjets.com'
    ) {
      throw new Error('invalid target');
    }
    expectedUrl = parsed.toString();
  } catch {
    const failedStages = INITIAL_STAGES.map((stage) => ({ ...stage }));
    failedStages[0] = { name: 'button', status: 'clicked' };
    failedStages[2] = { name: 'client', status: 'failed' };
    return emptyResult(failedStages, 'URL/configuration');
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
    return emptyResult(stages, 'confirmation');
  }

  if (!confirmed) {
    updateStage('confirmation', 'declined');
    return emptyResult(stages);
  }
  updateStage('confirmation', 'accepted');

  let fetchInitiated = false;
  let responseStatus: number | null = null;
  let client: ClerkApiConnectionClient;
  const hooks: ProductionAuthDiagnosticHooks = {
    expectedUrl,
    onTokenResult: (tokenObtained) =>
      updateStage('token', tokenObtained ? 'obtained' : 'failed', tokenObtained),
    onFetchInitiated: () => {
      fetchInitiated = true;
      updateStage('fetch', 'initiated');
    },
    onFetchCompleted: () => updateStage('fetch', 'completed'),
    onFetchFailed: () => updateStage('fetch', 'failed'),
  };

  updateStage('client', 'waiting');
  try {
    client = input.createApiClient(hooks);
    updateStage('client', 'initialized');
  } catch (error) {
    updateStage('client', 'failed');
    return emptyResult(stages, getSetupFailureCategory(error));
  }

  try {
    const { status, currentUser } = await client.getMeWithStatus((value) => {
      responseStatus = value;
    });
    return {
      httpStatus: status,
      authenticationAccepted: currentUser.isAuthenticated,
      isAuthenticated: currentUser.isAuthenticated,
      isMember: currentUser.isMember,
      isProfileComplete: currentUser.isProfileComplete,
      schemaStatus: 'valid',
      failureCategory: null,
      stages,
    };
  } catch (error) {
    return sanitizeDiagnosticFailure(error, responseStatus, stages, fetchInitiated);
  }
}

export function sanitizeDiagnosticFailure(
  error: unknown,
  responseStatus: number | null = null,
  stages: ClerkApiDiagnosticStage[] = INITIAL_STAGES.map((stage) => ({ ...stage })),
  fetchInitiated = false,
): ClerkApiConnectionDiagnosticResult {
  if (error instanceof ProductionAuthHttpError) {
    return {
      ...emptyResult(stages, 'HTTP'),
      httpStatus: error.status,
      authenticationAccepted: error.status === 401 ? false : null,
    };
  }

  const category = getFailureCategory(error, fetchInitiated);
  return {
    ...emptyResult(stages, category),
    httpStatus: responseStatus,
    schemaStatus: category === 'invalid schema' ? 'invalid' : 'not checked',
  };
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
