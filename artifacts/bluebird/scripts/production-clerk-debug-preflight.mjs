import { readFileSync } from 'node:fs';

const requiredProductionVariables = [
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER',
  'EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH',
];

const expectedProfileEnvironment = {
  EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production',
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG: 'true',
  EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST: 'true',
  EXPO_PUBLIC_ENABLE_CLERK_AUTH: 'false',
  EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO: 'false',
  EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE: 'production',
  EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE: 'production',
};

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDiagnosticProfileSafe() {
  try {
    const config = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
    const profile = config?.build?.['production-clerk-debug'];
    return profile?.extends === 'production' &&
      profile?.developmentClient === true &&
      profile?.distribution === 'internal' &&
      profile?.environment === 'production' &&
      JSON.stringify(profile?.env) === JSON.stringify(expectedProfileEnvironment);
  } catch {
    return false;
  }
}

const productionVariableStatus = Object.fromEntries(
  requiredProductionVariables.map((name) => [
    name,
    hasValue(process.env[name]) ? 'present' : 'missing',
  ]),
);
const missingVariables = Object.entries(productionVariableStatus)
  .filter(([, status]) => status === 'missing')
  .map(([name]) => name);
const profileStatus = isDiagnosticProfileSafe() ? 'configured' : 'blocked';
const blockers = [...missingVariables];
if (profileStatus !== 'configured') blockers.push('production-clerk-debug EAS profile is missing or unsafe.');
const easBuildBlockers = [
  'Remote EAS Production variable presence is inaccessible; authorized owner verification is required before a build.',
];

console.log(JSON.stringify({
  scope: 'Replit Metro process only; values are not read or printed',
  productionApiSelector: 'set to production by diagnostic launcher',
  requiredProductionVariables: productionVariableStatus,
  legacyDomain: hasValue(process.env.EXPO_PUBLIC_DOMAIN)
    ? 'present in parent workflow; omitted from diagnostic Metro process'
    : 'not configured in parent workflow',
  diagnosticProfile: profileStatus,
  remoteEasProductionVariables: 'inaccessible here',
  easBuildBlockers,
  blockers,
}, null, 2));

if (blockers.length > 0) process.exitCode = 1;
