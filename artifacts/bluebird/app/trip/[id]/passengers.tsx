import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTripManifest, useSaveTripManifest, useSubmitTripManifest,
  type Passenger,
} from '@workspace/api-client-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

type DraftPassenger = Passenger & { weightText: string };

export default function PassengerListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useGetTripManifest(id!);
  const [passengers, setPassengers] = useState<DraftPassenger[]>([]);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (data) setPassengers(data.passengers.map((passenger) => ({
      ...passenger, weightText: passenger.weightKg ? String(passenger.weightKg) : '',
    })));
  }, [data]);

  const save = useSaveTripManifest({
    mutation: {
      onSuccess: (manifest) => {
        setFeedback('Passenger information saved.');
        queryClient.setQueryData([`/api/trips/${id}/manifest`], manifest);
        queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
      },
      onError: (err: any) => setFeedback(err?.data?.error || err?.message || 'Unable to save passenger information.'),
    },
  });
  const submit = useSubmitTripManifest({
    mutation: {
      onSuccess: (manifest) => {
        setFeedback('Passenger list submitted. Bluebird operations was notified.');
        queryClient.setQueryData([`/api/trips/${id}/manifest`], manifest);
        queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
      },
      onError: (err: any) => setFeedback(err?.data?.error || err?.message || 'Unable to submit passenger list.'),
    },
  });

  const update = (index: number, field: keyof DraftPassenger, value: string) => {
    setFeedback('');
    setPassengers((current) => current.map((passenger, passengerIndex) =>
      passengerIndex === index ? { ...passenger, [field]: value } : passenger));
  };
  const complete = (passenger: DraftPassenger) => {
    const core = !!passenger.firstName.trim() && !!passenger.lastName.trim() && Number(passenger.weightText) > 0;
    return core && (!data?.international || (
      !!passenger.passportNumber?.trim() && !!passenger.issuingCountry?.trim() &&
      !!passenger.nationality?.trim() && validFutureDate(passenger.passportExpirationDate)
    ));
  };
  const completedCount = passengers.filter(complete).length;
  const allComplete = passengers.length > 0 && completedCount === passengers.length;
  const payload = () => passengers.map(({ weightText, ...passenger }) => ({
    ...passenger, weightKg: weightText ? Number(weightText) : null,
  }));
  const handleSave = () => save.mutate({ id: id!, data: { passengers: payload() } });
  const handleSubmit = () => submit.mutate({ id: id! });
  const pending = save.isPending || submit.isPending;

  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  if (isError || !data) return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <Feather name="lock" size={24} color={colors.mutedForeground} />
      <Text style={[styles.errorTitle, { color: colors.foreground }]}>Passenger list unavailable</Text>
      <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>{(error as any)?.data?.error || 'Only confirmed upcoming trips can access this list.'}</Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        style={styles.root}
        contentContainerStyle={{ padding: 20, paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 130 }}
        bottomOffset={70}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.hero, { backgroundColor: colors.backgroundMid }]}>
          <Text style={[styles.eyebrow, { color: colors.mutedOnBrand }]}>FLIGHT OPERATIONS</Text>
          <Text style={[styles.heading, { color: colors.textOnBrand }]}>Passenger Information</Text>
          <Text style={[styles.progress, { color: colors.paleBlueFaint }]}>{completedCount} of {data.requiredCount} completed</Text>
          <View style={[styles.track, { backgroundColor: colors.mutedOnBrand }]}>
            <View style={[styles.fill, { backgroundColor: colors.primary, width: `${(completedCount / data.requiredCount) * 100}%` }]} />
          </View>
        </View>
        {passengers.map((passenger, index) => (
          <View key={passenger.passengerOrder} style={[styles.card, { backgroundColor: colors.card, borderColor: complete(passenger) ? colors.success : colors.border }]}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={[styles.slot, { color: colors.mutedForeground }]}>TRAVELER {index + 1}</Text>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{passenger.firstName || passenger.lastName ? `${passenger.firstName} ${passenger.lastName}`.trim() : 'Add traveler details'}</Text>
              </View>
              <Feather name={complete(passenger) ? 'check-circle' : 'circle'} size={20} color={complete(passenger) ? colors.success : colors.mutedForeground} />
            </View>
            <View style={styles.row}>
              <Field label="First name" value={passenger.firstName} onChangeText={(v: string) => update(index, 'firstName', v)} colors={colors} />
              <Field label="Last name" value={passenger.lastName} onChangeText={(v: string) => update(index, 'lastName', v)} colors={colors} />
            </View>
            <Field label="Weight (kg)" value={passenger.weightText} onChangeText={(v: string) => update(index, 'weightText', v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" colors={colors} />
            {data.international && <>
              <Field label="Passport number" value={passenger.passportNumber ?? ''} onChangeText={(v: string) => update(index, 'passportNumber', v)} autoCapitalize="characters" colors={colors} />
              <View style={styles.row}>
                <Field label="Issuing country" value={passenger.issuingCountry ?? ''} onChangeText={(v: string) => update(index, 'issuingCountry', v)} colors={colors} />
                <Field label="Nationality" value={passenger.nationality ?? ''} onChangeText={(v: string) => update(index, 'nationality', v)} colors={colors} />
              </View>
              <Field label="Passport expiration (YYYY-MM-DD)" value={passenger.passportExpirationDate ?? ''} onChangeText={(v: string) => update(index, 'passportExpirationDate', v)} keyboardType="numbers-and-punctuation" colors={colors} />
            </>}
          </View>
        ))}
      </KeyboardAwareScrollViewCompat>
      <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.separator, paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 12 }]}>
        {!!feedback && <Text style={[styles.feedback, { color: feedback.includes('Unable') ? colors.destructive : colors.success }]}>{feedback}</Text>}
        <View style={styles.footerRow}>
          <TouchableOpacity testID="save-passenger-list" disabled={pending} style={[styles.secondary, { borderColor: colors.border }]} onPress={handleSave}>
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="submit-passenger-list" disabled={!allComplete || pending} style={[styles.primary, { backgroundColor: colors.primary }, (!allComplete || pending) && styles.disabled]} onPress={handleSubmit}>
            {pending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>{data.submittedAt ? 'Submitted' : data.version ? 'Submit Updated List' : 'Submit Passenger List'}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function validFutureDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && date > new Date();
}

function Field({ label, colors, ...props }: any) {
  return <View style={styles.field}><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text><TextInput {...props} placeholderTextColor={colors.mutedForeground} style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]} /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginTop: 12 }, errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 6 },
  hero: { borderRadius: 24, padding: 20, marginBottom: 16 }, eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 8 }, progress: { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 5 },
  track: { height: 4, borderRadius: 2, marginTop: 16, overflow: 'hidden', opacity: 0.8 }, fill: { height: 4, borderRadius: 2 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 }, cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  slot: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 }, cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 3 },
  row: { flexDirection: 'row', gap: 10 }, field: { flex: 1, marginBottom: 12 }, label: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 46, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  feedback: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', marginBottom: 8 },
  footerRow: { flexDirection: 'row', gap: 10 }, secondary: { minHeight: 48, paddingHorizontal: 24, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 }, primary: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 }, disabled: { opacity: 0.42 },
});