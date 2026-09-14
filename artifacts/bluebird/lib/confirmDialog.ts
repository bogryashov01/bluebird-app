import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirmation dialog.
 *
 * On react-native-web, `Alert.alert` button callbacks are no-ops, so any flow
 * relying on them silently stalls in the browser. This helper uses
 * `window.confirm` on web and `Alert.alert` on native, resolving to whether
 * the user accepted.
 */
export function confirmDialog(
  title: string,
  message: string,
  confirmLabel = 'Confirm',
  destructive = false,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`),
    );
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
