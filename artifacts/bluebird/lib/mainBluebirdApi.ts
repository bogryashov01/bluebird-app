import {
  createAuthenticatedProductionApiClient,
  ProductionAuthHttpError,
  ProductionAuthRequestError,
  type ProductionAuthDiagnosticHooks,
  type ProductionAuthApiOptions,
  type ProductionCurrentUser,
  type ProductionRequestOptions,
} from './productionAuthApi';
import {
  fetchProductionAirportCities,
  fetchProductionAirportSearch,
  fetchProductionAirports,
  fetchProductionFlight,
  fetchProductionFlights,
  type ReadRequestOptions,
} from './productionFlights';
import type {
  AirportRecord,
  FlightView,
  ProductionAirportCityGroupResponse,
} from './productionFlights';
import type { ClerkSessionSnapshot } from './clerkProductionTokenProvider';
import {
  getMainBluebirdApiConfiguration,
  getMainBluebirdDevelopmentDiagnosticStatus,
  MainBluebirdApiConfigurationError,
  resolveMainBluebirdApiConfiguration,
  type MainBluebirdApiConfiguration,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';
export { MainBluebirdApiConfigurationError } from './mainBluebirdApiConfig';
export {
  getMainBluebirdApiConfiguration,
  getMainBluebirdDevelopmentDiagnosticStatus,
  resolveMainBluebirdApiConfiguration,
} from './mainBluebirdApiConfig';
export type { MainBluebirdDevelopmentDiagnosticStatus } from './mainBluebirdApiConfig';

export interface EnvironmentBoundClerkTokenProvider {
  environment: MainBluebirdApiEnvironment;
  getVerifiedAccessToken: () => Promise<string | null>;
}

export interface MainBluebirdApiIntegrationOptions {
  configuration: MainBluebirdApiConfiguration;
  tokenProvider: EnvironmentBoundClerkTokenProvider;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  diagnostic?: ProductionAuthDiagnosticHooks;
}

export type MainBluebirdApiConnectionState =
  | 'unchecked'
  | 'authenticated'
  | 'not_authenticated'
  | 'unauthorized'
  | 'unavailable';

/**
 * Clerk sign-in, API authorization, and member identity are separate facts.
 * The current /api/me projection never verifies a Bluebird member ID.
 */
export interface MainBluebirdIntegrationState {
  clerk: 'loading' | 'signed_out' | 'signed_in';
  api: MainBluebirdApiConnectionState;
  memberIdentity: { status: 'unresolved'; reason: 'not_checked' | 'projection_only' };
}

export function getMainBluebirdIntegrationState(input: {
  configurationAvailable: boolean;
  clerkLoaded: boolean;
  clerkSignedIn: boolean | undefined;
  apiState?: MainBluebirdApiConnectionState;
  receivedProjection?: boolean;
}): MainBluebirdIntegrationState {
  const clerk = !input.clerkLoaded
    ? 'loading'
    : input.clerkSignedIn === true
      ? 'signed_in'
      : 'signed_out';
  const api = !input.configurationAvailable
    ? 'unavailable'
    : clerk !== 'signed_in'
      ? 'unchecked'
      : input.apiState ?? 'unchecked';
  return {
    clerk,
    api,
    memberIdentity: {
      status: 'unresolved',
      reason: input.receivedProjection ? 'projection_only' : 'not_checked',
    },
  };
}

export function getMainBluebirdApiConnectionState(error: unknown): MainBluebirdApiConnectionState {
  if (error instanceof ProductionAuthHttpError && error.status === 401) return 'unauthorized';
  if (error instanceof ProductionAuthRequestError || error instanceof Error) return 'unavailable';
  return 'unavailable';
}

function validateIntegrationConfiguration(
  configuration: MainBluebirdApiConfiguration,
): MainBluebirdApiConfiguration {
  if (!configuration || (configuration.environment !== 'development' && configuration.environment !== 'production')) {
    throw new MainBluebirdApiConfigurationError('environment');
  }
  const validated = resolveMainBluebirdApiConfiguration({
    environment: configuration.environment,
    developmentApiBaseUrl: configuration.environment === 'development'
      ? configuration.apiBaseUrl
      : undefined,
    productionApiBaseUrl: configuration.environment === 'production'
      ? configuration.apiBaseUrl
      : undefined,
    developmentClerkPublishableKey: configuration.environment === 'development'
      ? configuration.clerkPublishableKey
      : undefined,
    productionClerkPublishableKey: configuration.environment === 'production'
      ? configuration.clerkPublishableKey
      : undefined,
  });
  const selected = getMainBluebirdApiConfiguration();
  if (
    selected.environment !== validated.environment ||
    selected.apiBaseUrl !== validated.apiBaseUrl ||
    selected.clerkPublishableKey !== validated.clerkPublishableKey
  ) {
    throw new MainBluebirdApiConfigurationError('environment');
  }
  return validated;
}

export function createMainBluebirdApiIntegration(
  options: MainBluebirdApiIntegrationOptions,
) {
  const configuration = validateIntegrationConfiguration(options.configuration);
  if (
    !options.tokenProvider ||
    typeof options.tokenProvider.getVerifiedAccessToken !== 'function' ||
    options.tokenProvider.environment !== configuration.environment
  ) {
    throw new MainBluebirdApiConfigurationError('clerk_key');
  }

  const readOptions = (requestOptions: ReadRequestOptions = {}): ReadRequestOptions => ({
    ...requestOptions,
    environment: configuration.environment,
    baseUrl: configuration.apiBaseUrl,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  });
  const authOptions: ProductionAuthApiOptions = {
    tokenProvider: options.tokenProvider,
    environment: configuration.environment,
    baseUrl: configuration.apiBaseUrl,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.diagnostic ? { diagnostic: options.diagnostic } : {}),
  };
  const authenticated = createAuthenticatedProductionApiClient(authOptions);

  return {
    environment: configuration.environment,
    public: {
      listFlights: (requestOptions?: ReadRequestOptions): Promise<FlightView[]> =>
        fetchProductionFlights(readOptions(requestOptions)),
      getFlight: (id: number, requestOptions?: ReadRequestOptions): Promise<FlightView> =>
        fetchProductionFlight(id, readOptions(requestOptions)),
      getAirports: (codes: readonly string[], requestOptions?: ReadRequestOptions): Promise<AirportRecord[]> =>
        fetchProductionAirports(codes, readOptions(requestOptions)),
      searchAirports: (query: string, requestOptions?: ReadRequestOptions): Promise<AirportRecord[]> =>
        fetchProductionAirportSearch(query, readOptions(requestOptions)),
      getAirportCities: (requestOptions?: ReadRequestOptions): Promise<ProductionAirportCityGroupResponse[]> =>
        fetchProductionAirportCities(readOptions(requestOptions)),
    },
    authenticated,
    /** Explicitly invoked only; no health check or setup-time request occurs. */
    checkApiAuthentication: async (requestOptions?: ProductionRequestOptions) => {
      try {
        const currentUser: ProductionCurrentUser = await authenticated.getMe(requestOptions);
        return {
          api: currentUser.isAuthenticated ? 'authenticated' as const : 'not_authenticated' as const,
          memberIdentity: { status: 'unresolved' as const, reason: 'projection_only' as const },
        };
      } catch (error) {
        return {
          api: getMainBluebirdApiConnectionState(error),
          memberIdentity: { status: 'unresolved' as const, reason: 'not_checked' as const },
        };
      }
    },
  };
}

export function mainBluebirdAuthenticatedQueryKey(
  environment: MainBluebirdApiEnvironment,
  memberId: string,
  ...segments: readonly (string | number)[]
): readonly ['main-bluebird-api', MainBluebirdApiEnvironment, string, ...(string | number)[]] {
  if (environment !== 'development' && environment !== 'production') {
    throw new MainBluebirdApiConfigurationError('environment');
  }
  const subject = memberId.trim();
  if (!subject) throw new TypeError('A member ID is required for authenticated cache isolation.');
  return ['main-bluebird-api', environment, subject, ...segments] as const;
}

export function isDevelopmentMainApiConnectionAllowed(input: {
  isDevelopmentBuild: boolean;
  configuration: MainBluebirdApiConfiguration | null;
  session: Pick<ClerkSessionSnapshot, 'isLoaded' | 'isSignedIn'> | null;
}): boolean {
  return input.isDevelopmentBuild &&
    input.configuration?.environment === 'development' &&
    !!input.session?.isLoaded &&
    input.session.isSignedIn === true;
}
