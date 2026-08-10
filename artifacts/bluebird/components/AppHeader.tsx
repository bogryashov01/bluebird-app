import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Shared stack header for screens registered with `headerShown: true`
 * in app/_layout.tsx. Replaces the default native-stack header, which
 * rendered behind the iPhone notch/Dynamic Island, with an inset-aware
 * themed header:
 *  - iOS/Android: pads by `insets.top` (notch, Dynamic Island, status bar)
 *  - Web preview: fixed 67px inset, matching the app-wide web convention
 */
interface AppHeaderProps {
  navigation: { goBack: () => void };
  options: { title?: string };
  back?: unknown;
}

export function AppHeader({ navigation, options, back }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View
      style={{
        backgroundColor: colors.headerBackground,
        paddingTop: topPad,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.separator,
      }}
    >
      <View style={styles.row}>
        <View style={styles.side}>
          {back ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.6}
              testID="header-back"
              style={styles.backBtn}
            >
              <Feather name="chevron-left" size={26} color={colors.headerForeground} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={[styles.title, { color: colors.headerForeground }]}
        >
          {options.title ?? ''}
        </Text>
        <View style={styles.side} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  side: { width: 44, justifyContent: 'center' },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16.5,
  },
});
