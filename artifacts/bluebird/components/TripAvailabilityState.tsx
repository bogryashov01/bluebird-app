import React from 'react';
import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface TripAvailabilityStateProps {
  title: string;
  description: string;
  testID?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function TripAvailabilityState({
  title,
  description,
  testID = 'trip-availability-state',
  actionLabel,
  onAction,
}: TripAvailabilityStateProps) {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID={testID}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '14' }]}>
          <Feather name="lock" size={22} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.textOnSurface }]} testID={`${testID}-title`}>
          {title}
        </Text>
        <Text style={[styles.description, { color: colors.mutedForegroundLight }]} testID={`${testID}-description`}>
          {description}
        </Text>
        {actionLabel && onAction && (
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={onAction}
            testID={`${testID}-action`}
          >
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
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
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' },
  description: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
