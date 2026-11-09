import { startLiveMetro } from './live-metro.mjs';

/**
 * Local Simulator Metro matching production-live-internal product gates.
 * Does not change eas.json.
 *
 * PRODUCTION_CLERK_DEBUG must stay true in the Expo Dev Client: without it,
 * resolveRuntimeClerkAuthConfiguration treats Metro as development and falls
 * back to legacy auth (Get Started splash). Store RC builds are not
 * developmentClient, so they use Production Clerk with DEBUG=false.
 */
startLiveMetro({
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG: 'true',
  EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS: 'false',
  EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES: 'false',
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS: 'true',
  EXPO_PUBLIC_BLUEBIRD_PUSH_REGISTRATION: 'true',
}, {
  scope: 'RC-parity product gates on Dev Client (DEBUG=true required for Production Clerk locally). Values are not printed.',
});
