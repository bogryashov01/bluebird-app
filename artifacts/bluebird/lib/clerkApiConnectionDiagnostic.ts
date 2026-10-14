import {
  ProductionAuthHttpError,
  ProductionAuthRequestError,
  type ProductionCurrentUser,
} from './productionAuthApi';
export { createAuthenticatedProductionApiClient } from './productionAuthApi';

export type ClerkApiConnectionFailureCategory =
  | 'HTTP'
  | 'network/CORS'
  | 'timeout'
  | 'token'
  | 'schema';

export interface ClerkApiConnectionDiagnosticResult {
  httpStatus: number | null;
  authenticationAccepted: boolean | null;
  isAuthenticated: boolean | null;
  isMember: boolean | null;
  isProfileComplete: boolean | null;
  schemaStatus: 'valid' | 'invalid' | 'not checked';
  failureCategory: ClerkApiConnectionFailureCategory | null;
}

export interface ClerkApiConnectionClient {
  getMeWithStatus: (
    onResponseStatus?: (status: number) => void,
  ) => Promise<{ status: number; currentUser: ProductionCurrentUser }>;
}

export function isClerkApiConnectionTestVisible(input: {
  isDevelopment: boolean;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
}): boolean {
  return input.isDevelopment && input.isLoaded && input.isSignedIn === true;
}

export async function runClerkApiConnectionTest(input: {
  isDevelopment: boolean;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  confirm: (title: string, message: string, confirmLabel: string) => Promise<boolean>;
  createApiClient: () => ClerkApiConnectionClient;
}): Promise<ClerkApiConnectionDiagnosticResult | null> {
  if (!isClerkApiConnectionTestVisible(input)) return null;

  const confirmed = await input.confirm(
    'Test Bluebird API Connection',
    'This will send one authenticated GET request to the production Bluebird API. Continue?',
    'Send request',
  );
  if (!confirmed) return null;

  let responseStatus: number | null = null;
  try {
    const { status, currentUser } = await input.createApiClient().getMeWithStatus((value) => {
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
    };
  } catch (error) {
    return sanitizeDiagnosticFailure(error, responseStatus);
  }
}

export function sanitizeDiagnosticFailure(
  error: unknown,
  responseStatus: number | null = null,
): ClerkApiConnectionDiagnosticResult {
  if (error instanceof ProductionAuthHttpError) {
    return {
      httpStatus: error.status,
      authenticationAccepted: error.status === 401 ? false : null,
      isAuthenticated: null,
      isMember: null,
      isProfileComplete: null,
      schemaStatus: 'not checked',
      failureCategory: 'HTTP',
    };
  }

  const category = getFailureCategory(error);
  return {
    httpStatus: responseStatus,
    authenticationAccepted: null,
    isAuthenticated: null,
    isMember: null,
    isProfileComplete: null,
    schemaStatus: category === 'schema' ? 'invalid' : 'not checked',
    failureCategory: category,
  };
}

function getFailureCategory(error: unknown): ClerkApiConnectionFailureCategory {
  if (!(error instanceof ProductionAuthRequestError)) return 'network/CORS';
  switch (error.code) {
    case 'token':
      return 'token';
    case 'timeout':
      return 'timeout';
    case 'invalid_json':
    case 'invalid_schema':
      return 'schema';
    case 'network':
    case 'cancelled':
      return 'network/CORS';
    case 'http':
    case 'session_expired':
      return 'HTTP';
  }
}
