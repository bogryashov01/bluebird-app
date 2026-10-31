import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { formatJoinFlightDate, formatJoinFlightTime, type JoinFlightDisplay } from '@/lib/joinFlightPresentation';
import {
  QUEUE_ACKNOWLEDGEMENT_ITEMS,
  QUEUE_ACKNOWLEDGEMENT_LEGAL,
  QUEUE_PET_FEE_ACKNOWLEDGEMENT,
  QUEUE_PET_FEE_NOTICE,
  QUEUE_PET_QUESTION,
  queueAcknowledgementsComplete,
} from '@/lib/queueAcknowledgements';

export function QueueAcknowledgement({
  flight,
  onContinue,
}: {
  flight: JoinFlightDisplay;
  onContinue: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [checked, setChecked] = useState(() => QUEUE_ACKNOWLEDGEMENT_ITEMS.map(() => false));
  const [bringingPet, setBringingPet] = useState<boolean | null>(null);
  const [petFeeAcknowledged, setPetFeeAcknowledged] = useState(false);
  const complete = queueAcknowledgementsComplete({ checked, bringingPet, petFeeAcknowledged });
  const route = [flight.fromCity ?? flight.fromAirport, flight.toCity ?? flight.toAirport].filter(Boolean).join(' → ');

  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite }]} testID="queue-acknowledgement">
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Before you join{'\n'}the queue</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
          Please review and confirm the following{route ? ` for ${route}` : ''}.
        </Text>
        {!!formatJoinFlightDate(flight.departureDate) && (
          <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
            {[formatJoinFlightDate(flight.departureDate), formatJoinFlightTime(flight.departureTime)].filter(Boolean).join(' · ')}
          </Text>
        )}
        {QUEUE_ACKNOWLEDGEMENT_ITEMS.map((item, index) => (
          <TouchableOpacity
            key={item.id}
            testID={`queue-ack-${item.id}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: checked[index] === true }}
            style={[styles.checkRow, { backgroundColor: colors.surface, borderColor: colors.separator }]}
            onPress={() => setChecked((current) => current.map((value, itemIndex) => itemIndex === index ? !value : value))}
          >
            <Mark checked={checked[index] === true} />
            <Text style={[styles.checkText, { color: colors.textOnSurface }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={[styles.petCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
          <Text style={[styles.petTitle, { color: colors.textOnSurface }]}>{QUEUE_PET_QUESTION}</Text>
          <View style={styles.choiceRow}>
            {([false, true] as const).map((value) => {
              const selected = bringingPet === value;
              return (
                <TouchableOpacity
                  key={String(value)}
                  testID={`traveling-pet-${value ? 'yes' : 'no'}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.choice, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + '14' : 'transparent' }]}
                  onPress={() => {
                    setBringingPet(value);
                    if (!value) setPetFeeAcknowledged(false);
                  }}
                >
                  <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.textOnSurface }]}>
                    {value ? 'Yes' : 'No'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {bringingPet === true ? (
            <>
              <Text testID="queue-pet-fee-notice" style={[styles.notice, { color: colors.textOnSurface }]}>{QUEUE_PET_FEE_NOTICE}</Text>
              <TouchableOpacity
                testID="pet-fee-acknowledgement"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: petFeeAcknowledged }}
                style={styles.feeRow}
                onPress={() => setPetFeeAcknowledged((value) => !value)}
              >
                <Mark checked={petFeeAcknowledged} />
                <Text style={[styles.checkText, { color: colors.textOnSurface }]}>{QUEUE_PET_FEE_ACKNOWLEDGEMENT}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
        <Text style={[styles.legal, { color: colors.mutedForegroundLight }]}>{QUEUE_ACKNOWLEDGEMENT_LEGAL}</Text>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.separator, paddingBottom: bottomPad + 12 }]}>
        {complete ? null : (
          <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>Check all items above to continue</Text>
        )}
        <PrimaryButton
          label="I Acknowledge — Continue"
          testID="queue-continue-button"
          disabled={!complete}
          onPress={() => {
            if (!complete) return;
            onContinue();
          }}
        />
      </View>
    </View>
  );
}

function Mark({ checked }: { checked: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.checkbox, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : 'transparent' }]}>
      {checked ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 22, gap: 12, paddingBottom: 24 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 33, letterSpacing: -0.35 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, borderRadius: 16, borderWidth: 1, padding: 16 },
  checkText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  petCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  petTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  choiceText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  notice: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  feeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  legal: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
