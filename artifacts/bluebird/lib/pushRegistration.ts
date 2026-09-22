import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { getApiBaseUrl } from '@/lib/apiBaseUrl';

export type PushRegistrationStatus = {
  physicalDeviceLikely: boolean;
  os: typeof Platform.OS;
  appOwnership: string | null;
  executionEnvironment: string | null;
  deviceName: string | null;
  permission: string;
  projectId: string | null;
  apiBaseUrl: string | null;
  tokenSuffix: string | null;
  registered: boolean;
  error: string | null;
};

export function resolveExpoProjectId(): string | null {
  const fromEas = Constants.easConfig?.projectId?.trim();
  if (fromEas) return fromEas;
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId?.trim();
  if (fromExtra) return fromExtra;
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  return fromEnv || null;
}

function tokenSuffix(token: string): string {
  const inner = token.replace(/^ExponentPushToken\[/, '').replace(/\]$/, '');
  return inner.length <= 8 ? inner : inner.slice(-8);
}

function detectPhysicalDevice(): { physicalDeviceLikely: boolean; hint: string } {
  if (Platform.OS === 'web') {
    return { physicalDeviceLikely: false, hint: 'web' };
  }
  const ios = Constants.platform?.ios as
    | { simulator?: boolean; model?: string | null; platform?: string }
    | undefined;
  if (ios?.simulator === true) {
    return {
      physicalDeviceLikely: false,
      hint: 'iOS Simulator — APNs / Expo push tokens are not issued here',
    };
  }
  const model = `${ios?.model ?? ''} ${Constants.deviceName ?? ''}`;
  if (/simulator/i.test(model)) {
    return {
      physicalDeviceLikely: false,
      hint: 'iOS Simulator — APNs / Expo push tokens are not issued here',
    };
  }
  return {
    physicalDeviceLikely: true,
    hint: Platform.OS === 'ios'
      ? 'iOS runtime (physical iPhone required; Simulator cannot receive OS pushes)'
      : Platform.OS,
  };
}

function logPush(message: string, extra?: Record<string, unknown>) {
  if (!__DEV__) return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[bluebird push] ${message}${suffix}`);
}

/**
 * Development-only: show incoming test pushes while the app is foregrounded.
 * Production keeps the default handler so OS presentation is unchanged.
 */
export function installDevPushHandler(): void {
  if (!__DEV__) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function registerExpoPushToken(
  register: (token: string) => Promise<unknown>,
  membershipTier: string | undefined,
): Promise<PushRegistrationStatus> {
  const device = detectPhysicalDevice();
  const status: PushRegistrationStatus = {
    physicalDeviceLikely: device.physicalDeviceLikely,
    os: Platform.OS,
    appOwnership: Constants.appOwnership ?? null,
    executionEnvironment: Constants.executionEnvironment ?? null,
    deviceName: Constants.deviceName ?? null,
    permission: 'undetermined',
    projectId: resolveExpoProjectId(),
    apiBaseUrl: getApiBaseUrl(),
    tokenSuffix: null,
    registered: false,
    error: null,
  };

  logPush('registration start', {
    physicalDeviceLikely: status.physicalDeviceLikely,
    deviceHint: device.hint,
    os: status.os,
    appOwnership: status.appOwnership,
    executionEnvironment: status.executionEnvironment,
    deviceName: status.deviceName,
    projectIdPresent: Boolean(status.projectId),
    apiBaseUrl: status.apiBaseUrl,
    membershipTier: membershipTier ?? null,
  });

  if (Platform.OS === 'web') {
    status.error = 'web does not support Expo push registration';
    logPush('skipped', { reason: status.error, os: status.os });
    return status;
  }
  if (membershipTier === 'none') {
    status.error = 'push registration waits until the account has a membership';
    logPush('skipped', { reason: status.error });
    return status;
  }

  try {
    const current = await Notifications.getPermissionsAsync();
    status.permission = current.status;
    logPush('permission status', { permission: current.status });
    if (current.status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status.permission = requested.status;
      logPush('permission request result', { permission: requested.status });
    }
    if (status.permission !== 'granted') {
      status.error = `notification permission is ${status.permission}`;
      logPush('stopped', { reason: status.error });
      return status;
    }

    if (!status.projectId) {
      status.error =
        'missing Expo projectId (app.json extra.eas.projectId). Log in and run eas init — do not invent an ID';
      logPush('blocked', { reason: status.error });
      return status;
    }

    const push = await Notifications.getExpoPushTokenAsync({ projectId: status.projectId });
    if (!push.data) {
      status.error = 'getExpoPushTokenAsync returned an empty token';
      logPush('failed', { reason: status.error });
      return status;
    }
    status.tokenSuffix = tokenSuffix(push.data);
    logPush('Expo Push Token generated', { tokenSuffix: status.tokenSuffix, os: status.os });

    await register(push.data);
    status.registered = true;
    logPush('token registered with local API', { tokenSuffix: status.tokenSuffix });
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'push registration failed';
    status.error = message;
    logPush('failed', { reason: message });
    return status;
  }
}
