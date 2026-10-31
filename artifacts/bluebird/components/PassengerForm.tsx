import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  PASSENGER_GENDER_NOTE,
  PASSENGER_SAVE_UNAVAILABLE,
  type PassengerFormErrors,
  type PassengerFormValues,
} from '@/lib/passengerManifest';

export function PassengerForm({
  title,
  values,
  errors,
  notice,
  writesOpen = false,
  loading = false,
  onChange,
  onSubmit,
}: {
  title: string;
  values: PassengerFormValues;
  errors: PassengerFormErrors;
  notice: string | null;
  writesOpen?: boolean;
  loading?: boolean;
  onChange: (values: PassengerFormValues) => void;
  onSubmit: () => void;
}) {
  const colors = useColors();
  const update = (patch: Partial<PassengerFormValues>) => onChange({ ...values, ...patch });
  return (
    <View testID="passenger-form" style={styles.form}>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Field label="First Name" error={errors.firstName} colors={colors}>
        <TextInput
          testID="passenger-first-name"
          value={values.firstName}
          onChangeText={(firstName) => update({ firstName })}
          autoCapitalize="words"
          autoCorrect={false}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        />
      </Field>
      <Field label="Middle Name (optional)" error={errors.middleName} colors={colors}>
        <TextInput
          testID="passenger-middle-name"
          value={values.middleName}
          onChangeText={(middleName) => update({ middleName })}
          autoCapitalize="words"
          autoCorrect={false}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        />
      </Field>
      <Field label="Last Name" error={errors.lastName} colors={colors}>
        <TextInput
          testID="passenger-last-name"
          value={values.lastName}
          onChangeText={(lastName) => update({ lastName })}
          autoCapitalize="words"
          autoCorrect={false}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        />
      </Field>
      <Field label="Weight (lbs)" error={errors.weightLbs} colors={colors}>
        <TextInput
          testID="passenger-weight"
          value={values.weightLbs}
          onChangeText={(weightLbs) => update({ weightLbs })}
          keyboardType="number-pad"
          inputMode="numeric"
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        />
      </Field>
      <Field label="Date of Birth" error={errors.dob} colors={colors}>
        <TextInput
          testID="passenger-dob"
          value={values.dob}
          onChangeText={(dob) => update({ dob })}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        />
        <Text style={[styles.help, { color: colors.mutedForeground }]}>Use year-month-day, for example 1990-05-12.</Text>
      </Field>
      <Field label="Gender" error={errors.gender} colors={colors}>
        <View style={styles.choiceRow}>
          {(['female', 'male'] as const).map((gender) => {
            const selected = values.gender === gender;
            return (
              <Pressable
                key={gender}
                testID={`passenger-gender-${gender}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => update({ gender })}
                style={[
                  styles.choice,
                  {
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.card : colors.background,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primary : colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
                  {gender === 'female' ? 'Female' : 'Male'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.help, { color: colors.mutedForeground }]}>{PASSENGER_GENDER_NOTE}</Text>
      </Field>
      <Field label="Notes (optional)" error={errors.notes} colors={colors}>
        <TextInput
          testID="passenger-notes"
          value={values.notes}
          onChangeText={(notes) => update({ notes })}
          multiline
          style={[styles.input, styles.notes, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        />
      </Field>
      <PrimaryButton
        label="Save passenger"
        testID="passenger-save"
        onPress={onSubmit}
        loading={loading}
      />
      <Text testID="passenger-save-unavailable" style={[styles.help, { color: colors.mutedForeground }]}>
        {notice ?? (writesOpen ? '' : PASSENGER_SAVE_UNAVAILABLE)}
      </Text>
    </View>
  );
}

function Field({
  label,
  error,
  colors,
  children,
}: {
  label: string;
  error?: string;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      {children}
      {!!error && <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.3 },
  field: { gap: 6 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
  },
  notes: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  help: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  error: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
