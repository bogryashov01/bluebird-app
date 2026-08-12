import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton } from '@/components/PrimaryButton';

/**
 * Full-screen friendly state shown anywhere in the join flow when the flight
 * turns out to be non-joinable (departed, cancelled, completed) — either
 * detected up front via the flight's live status or via the server's
 * "no longer available" rejection. Offers a way back to browsing.
 */
export function FlightUnavailableState({
  status,
  bottomPad,
}: {
  status?: string;
  bottomPad: number;
}) {
  const colors = useColors();
  const statusText =
    status === 'cancelled' ? 'This flight was cancelled.' :
    status === 'departed' ? 'This flight has already departed.' :
    status === 'completed' ? 'This flight has already been completed.' :
    'This flight is no longer available.';

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <FloatingBackButton />
      <View style={styles.wrap}>
        <View style={[styles.icon, { backgroundColor: colors.surface }]}>
          <Feather name="slash" size={28} color={colors.mutedForegroundLight} />
        </View>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>
          Flight no longer available
        </Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
          {statusText} No worries — there are more empty legs waiting for you.
        </Text>
        <View style={{ alignSelf: 'stretch', paddingBottom: bottomPad + 12 }}>
          <PrimaryButton
            label="Browse other flights"
            onPress={() => router.replace('/(tabs)/discover')}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  wrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28, gap: 14,
  },
  icon: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.05, elevation: 2,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginBottom: 10 },
});
