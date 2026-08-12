import React from 'react';
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Custom stack header for the AI Concierge screen only.
 *
 * Matches the concierge design: back chevron, circular brand avatar,
 * left-aligned title with an availability subtitle ("Instant answers, 24/7")
 * and a status dot. Uses the same safe-area handling as the shared
 * AppHeader (insets.top on native, fixed 67px on web).
 */
interface ConciergeHeaderProps {
  navigation: { goBack: () => void };
  options: { title?: string };
  back?: unknown;
}

export function ConciergeHeader({ navigation, back }: ConciergeHeaderProps) {
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
        ) : (
          <View style={styles.backBtn} />
        )}
        <View style={[styles.avatar, { backgroundColor: colors.backgroundMid }]}>
          <Image
            source={require('@/assets/images/bluebird-logo-white.png')}
            style={styles.avatarLogo}
            resizeMode="contain"
          />
        </View>
        <View style={styles.titleBlock}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: colors.headerForeground }]}
          >
            AI Concierge
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.subtitle, { color: colors.primary }]}>
              Instant answers, 24/7
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLogo: { width: 24, height: 24 },
  titleBlock: { flex: 1, justifyContent: 'center' },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16.5,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
});
