import { useSyncExternalStore } from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { PUSH_ACCOUNT_PREFERENCES } from '@/lib/clerkPushNotifications';
import {
  getClerkPushUiState,
  requestClerkPushPermission,
  subscribeClerkPushUi,
} from '@/lib/clerkPushRuntime';

export function ClerkPushPermissionStatus() {
  const colors = useColors();
  const state = useSyncExternalStore(subscribeClerkPushUi, getClerkPushUiState, getClerkPushUiState);
  return (
    <View
      testID="clerk-push-permission"
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 12,
        backgroundColor: colors.surface,
        gap: 8,
      }}
    >
      <Text style={{ color: colors.mutedForegroundLight, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>
        THIS IPHONE
      </Text>
      <Text testID="clerk-push-permission-status" style={{ color: colors.textOnSurface, fontFamily: 'Inter_400Regular', fontSize: 14 }}>
        {state.permissionLabel}
      </Text>
      <Text testID="clerk-push-account-preferences" style={{ color: colors.mutedForegroundLight, fontFamily: 'Inter_400Regular', fontSize: 13 }}>
        {PUSH_ACCOUNT_PREFERENCES}
      </Text>
      <Text testID="clerk-push-delivery" style={{ color: colors.mutedForegroundLight, fontFamily: 'Inter_400Regular', fontSize: 13 }}>
        {state.deliveryLabel}
      </Text>
      {state.promptAvailable ? (
        <TouchableOpacity
          accessibilityRole="button"
          testID="clerk-push-permission-request"
          onPress={() => { void requestClerkPushPermission(); }}
        >
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
            Allow notifications
          </Text>
        </TouchableOpacity>
      ) : null}
      {state.settingsAvailable ? (
        <TouchableOpacity
          accessibilityRole="button"
          testID="clerk-push-open-settings"
          onPress={() => { void Linking.openSettings(); }}
        >
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
            Open iOS Settings
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
