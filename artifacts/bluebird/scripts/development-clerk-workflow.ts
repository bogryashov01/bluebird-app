import {
  getMainBluebirdDevelopmentDiagnosticStatus,
} from '../lib/mainBluebirdApiConfig';
import {
  resolveClerkAuthConfigurationFromEnvironment,
} from '../lib/clerkAuthConfig';

export interface DevelopmentClerkWorkflowStatus {
  ready: boolean;
  selectedEnvironment: 'development' | 'not development';
  developmentApi: 'configured' | 'blocked';
  developmentClerk: 'configured' | 'blocked';
  issuerMatch: 'matched' | 'unverified';
  clerkAuth: 'enabled' | 'disabled';
  fullAppDemo: 'enabled' | 'disabled';
  blockers: string[];
}

export function getDevelopmentClerkWorkflowStatus(
  environment: Record<string, unknown>,
): DevelopmentClerkWorkflowStatus {
  const diagnostic = getMainBluebirdDevelopmentDiagnosticStatus(environment);
  const clerk = resolveClerkAuthConfigurationFromEnvironment(environment, true);
  const demoEnabled = environment.EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO === 'true';
  const blockers = [...diagnostic.missingPrerequisites];

  if (!clerk.enabled) {
    blockers.push(clerk.configurationError ?? 'Development Clerk configuration is disabled.');
  }
  if (demoEnabled) {
    blockers.push('EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO must not enable demo mode.');
  }

  return {
    ready: blockers.length === 0 &&
      diagnostic.canTest &&
      clerk.enabled &&
      clerk.environment === 'development' &&
      !demoEnabled,
    selectedEnvironment: diagnostic.checks.some(
      (check) => check.name === 'EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT' && check.status === 'selected',
    ) ? 'development' : 'not development',
    developmentApi: diagnostic.checks.some(
      (check) => check.name === 'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL' && check.status === 'configured',
    ) ? 'configured' : 'blocked',
    developmentClerk: diagnostic.checks.some(
      (check) => check.name === 'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY' && check.status === 'configured',
    ) ? 'configured' : 'blocked',
    issuerMatch: diagnostic.clerkInstanceMatchVerified ? 'matched' : 'unverified',
    clerkAuth: diagnostic.clerkAuthEnabled && clerk.enabled ? 'enabled' : 'disabled',
    fullAppDemo: demoEnabled ? 'enabled' : 'disabled',
    blockers,
  };
}

function reportDevelopmentClerkWorkflowPreflight(): void {
  const status = getDevelopmentClerkWorkflowStatus(process.env);
  const safeStatus = {
    selectedEnvironment: status.selectedEnvironment,
    developmentApi: status.developmentApi,
    developmentClerk: status.developmentClerk,
    issuerMatch: status.issuerMatch,
    clerkAuth: status.clerkAuth,
    fullAppDemo: status.fullAppDemo,
  };

  if (!status.ready) {
    console.error('[Bluebird Clerk Development preflight] blocked', {
      ...safeStatus,
      blockers: status.blockers,
    });
    process.exitCode = 1;
    return;
  }

  console.info('[Bluebird Clerk Development preflight] ready', safeStatus);
}

if (process.env.BLUEBIRD_CLERK_PREFLIGHT_RUN === 'true') {
  reportDevelopmentClerkWorkflowPreflight();
}
