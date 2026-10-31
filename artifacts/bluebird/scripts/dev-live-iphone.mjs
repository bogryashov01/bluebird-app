import { startLiveMetro } from './live-metro.mjs';

startLiveMetro({
  EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS: 'false',
  EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES: 'false',
}, {
  scope: 'Local iPhone Metro only. Values are not printed.',
});
