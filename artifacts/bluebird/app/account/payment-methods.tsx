import React from 'react';
import {
  Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function PaymentMethodsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const goToProfile = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile' as any);
    }
  };

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.offWhite, paddingTop: topPad + 12, paddingBottom: insets.bottom },
      ]}
      testID="payment-methods-screen"
    >
      <TouchableOpacity
        onPress={goToProfile}
        style={[styles.backButton, { backgroundColor: colors.surface }]}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Back to Profile"
        testID="payment-methods-back"
      >
        <Feather name="chevron-left" size={23} color={colors.textOnSurface} />
      </TouchableOpacity>

      <Text style={[styles.pageTitle, { color: colors.textOnSurface }]}>
        Payment Methods
      </Text>

      <Text style={[styles.introTitle, { color: colors.textOnSurface }]}>
        Your payment methods
      </Text>
      <Text style={[styles.description, { color: colors.mutedForegroundLight }]}>
        Manage payment methods for your Bluebird membership.
      </Text>

      <View
        style={[
          styles.emptyCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        testID="payment-methods-empty-state"
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.muted }]}>
          <Feather name="credit-card" size={23} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.textOnSurface }]}>
          No payment methods available
        </Text>
        <Text style={[styles.supportingText, { color: colors.mutedForegroundLight }]}>
          Payment method management is coming soon.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 22,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  pageTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    lineHeight: 33,
    marginBottom: 24,
  },
  introTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    lineHeight: 23,
  },
  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: 18,
  },
  emptyCard: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  supportingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 5,
  },
});
