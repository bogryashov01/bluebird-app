import { readFileSync } from 'node:fs';
import { getProductionAuthPreflightStatus } from './.production-auth-preflight-lib.mjs';

const requiredVariables = [
  'EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER',
  'EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH',
];

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getCheckedInProductionProfileStatus() {
  try {
    const easConfig = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
    const productionProfile = easConfig?.build?.production;
    return productionProfile?.environment === 'production' &&
      productionProfile?.distribution === 'store'
      ? 'configured'
      : 'missing or invalid';
  } catch {
    return 'missing or invalid';
  }
}

console.log(JSON.stringify({
  scope: 'Mobile local workspace only',
  production: getProductionAuthPreflightStatus(process.env),
  localRequiredVariables: Object.fromEntries(
    requiredVariables.map((name) => [name, hasValue(process.env[name]) ? 'present' : 'missing']),
  ),
  expoPublicDomain: hasValue(process.env.EXPO_PUBLIC_DOMAIN) ? 'present' : 'not configured',
  checkedInEasProductionProfile: getCheckedInProductionProfileStatus(),
  remoteEasProductionValues: 'not inspectable from this workspace',
}, null, 2));
