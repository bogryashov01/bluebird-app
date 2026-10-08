import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { parseProductionFlightId } from '@/lib/productionFlights';

interface ProductionReadOnlyNoticeProps {
  flightId?: string | number | null;
  title?: string;
  description?: string;
}

export function ProductionReadOnlyNotice({
  flightId,
  title = 'Queue unavailable in this preview',
  description = 'Production sign-in is not connected here, so queue status and actions are not loaded. You can view the flight, but cannot join or leave a queue, use a pass, or confirm or decline a win.',
}: ProductionReadOnlyNoticeProps) {
  const colors = useColors();
  const validatedFlightId = parseProductionFlightId(flightId);

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      testID="production-read-only-notice"
    >
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '14' }]}>
          <Feather name="lock" size={22} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>{title}</Text>
        <Text style={[styles.description, { color: colors.mutedForegroundLight }]}>{description}</Text>

        {validatedFlightId !== null && (
          <Text
            style={[styles.flightId, { color: colors.mutedForegroundLight }]}
            testID="production-flight-id"
          >
            Production flight ID: {validatedFlightId}
          </Text>
        )}

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={validatedFlightId !== null ? 'View flight details' : 'Browse production flights'}
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={() => {
            if (validatedFlightId !== null) {
              router.replace(`/flight/${validatedFlightId}`);
            } else {
              router.replace('/(tabs)/discover');
            }
          }}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            {validatedFlightId !== null ? 'View Flight Details' : 'Browse Production Flights'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' },
  description: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  flightId: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 2 },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
