/**
 * A development bundle is using the production member API.
 * The full-app demo is the only production-environment path that may show fixtures.
 */
export function isProductionMemberDataSelected(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT === 'production'
    && environment.EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO !== 'true';
}
