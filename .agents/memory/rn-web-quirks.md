---
name: React Native web quirks (Bluebird)
description: Web-platform pitfalls when the Expo app runs in the browser.
---

- **Alert.alert with buttons is a no-op on react-native-web.** Any flow relying on an Alert button's `onPress` (confirmations, post-success navigation) silently stalls in the browser. **How to apply:** use the shared `confirmDialog` helper (web → `window.confirm`, native → `Alert.alert`) or gate on `Platform.OS === 'web'` and run the action directly.
- **Bluebird Preview storage is origin-scoped.** Expo's web Preview uses its own `*.expo.worf.replit.dev` origin, distinct from the `*.worf.replit.dev` API/development host. **Why:** browser localStorage is isolated by origin, so deleting Bluebird session keys on the API host does not clear the Preview session. **How to apply:** inspect or clear session state on the actual Expo Preview origin when diagnosing signed-in startup.
- New expo-router screens require restarting the expo dev server to regenerate typed routes, otherwise `tsc` rejects the new pathnames.
- RN-web TouchableOpacity may not expose `aria-disabled`; verify gating behaviorally (click does nothing), not by DOM attribute.
