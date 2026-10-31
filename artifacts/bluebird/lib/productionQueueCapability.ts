import { isNativeProductionAuthTestEnabled } from './nativeAuthTestPolicy';

/**
 * Join and leave stay off unless this flag is exactly "true" and the build is
 * not the native auth-test. The auth-test request guard still blocks POST and
 * DELETE even if this flag is set.
 */
export const PRODUCTION_QUEUE_MUTATIONS_FLAG = 'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS';

export function isProductionQueueMutationsEnabled(input?: {
  flag?: string;
  nativeAuthTest?: boolean;
}): boolean {
  const flag = input?.flag ?? process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS;
  const nativeAuthTest = input?.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  return flag === 'true' && nativeAuthTest !== true;
}
