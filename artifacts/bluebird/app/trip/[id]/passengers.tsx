import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTripManifest,
  useSaveTripManifest,
  useSubmitTripManifest,
  type Passenger,
} from '@workspace/api-client-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { prefillPrimaryPassenger } from '@/lib/passenger-name';
import { MAX_OCCUPANTS, maxPassengersForBooking } from '@/lib/passengerCapacity';
type DraftPassenger = Omit<Passenger, 'dateOfBirth' | 'weightKg'> & {
  dateOfBirth: string;
  weightKg: string;
};
type PetDraft = {
  weightLb: string;
  crateLengthIn: string;
  crateWidthIn: string;
  crateHeightIn: string;
};
type ScreenMode = 'edit' | 'review';

const EMPTY_PET: PetDraft = {
  weightLb: '',
  crateLengthIn: '',
  crateWidthIn: '',
  crateHeightIn: '',
};

export default function PassengerListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const manifestQueryKey = [`/api/trips/${id}/manifest`, user?.id ?? 'signed-out'] as const;
  const { data, isLoading, isFetching, isError, error } = useGetTripManifest(id!, {
    query: { enabled: !!id && !!user, queryKey: manifestQueryKey },
  });
  const [passengers, setPassengers] = useState<DraftPassenger[]>([]);
  const [pet, setPet] = useState<PetDraft>(EMPTY_PET);
  const [mode, setMode] = useState<ScreenMode>('edit');
  const [editingSection, setEditingSection] = useState<'passengers' | 'pet' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [dirty, setDirty] = useState(false);
  const [hydratedIdentity, setHydratedIdentity] = useState('');
  const resetIdentity = useRef('');
  const reviewAfterSave = useRef(false);
  const manifestIdentity = `${user?.id ?? 'signed-out'}:${id ?? ''}`;
  const humanPassengerLimit = data
    ? Math.min(data.requiredCount, maxPassengersForBooking(data.bringingPet))
    : 0;
  const canAddPassenger = passengers.length < humanPassengerLimit;
  const capacityGuidance = data?.bringingPet
    ? 'A pet counts as one of 6 occupants.'
    : passengers.length >= (data?.requiredCount ?? 0)
      ? 'This booking has reached its reserved passenger capacity.'
      : `Maximum ${MAX_OCCUPANTS} occupants per booking.`;

  useEffect(() => {
    const identityChanged = hydratedIdentity !== manifestIdentity;
    if (identityChanged) {
      // Clear the previous member/trip draft before the new query resolves.
      // This prevents a cached or in-flight response from briefly exposing
      // another member's passenger details.
      if (resetIdentity.current !== manifestIdentity) {
        resetIdentity.current = manifestIdentity;
        setPassengers([]);
        setPet(EMPTY_PET);
        setMode('edit');
        setEditingSection(null);
        setFeedback('');
        setDirty(false);
      }
      if (!data || data.tripId !== id || isFetching) return;
    } else if (!data || data.tripId !== id || isFetching || dirty) {
      return;
    }

    const restoredPassengers = data.passengers.map((passenger) => ({
      ...passenger,
      dateOfBirth: passenger.dateOfBirth ?? '',
      weightKg: passenger.weightKg == null ? '' : String(passenger.weightKg),
    }));
    setPassengers(identityChanged
      ? prefillPrimaryPassenger(restoredPassengers, user?.name)
      : restoredPassengers);
    if (data.pet) {
      setPet({
        weightLb: String(data.pet.weightLb ?? ''),
        crateLengthIn: String(data.pet.crateLengthIn ?? ''),
        crateWidthIn: String(data.pet.crateWidthIn ?? ''),
        crateHeightIn: String(data.pet.crateHeightIn ?? ''),
      });
    } else {
      setPet(EMPTY_PET);
    }
    if (identityChanged) {
      setMode(data.submittedAt ? 'review' : 'edit');
      setEditingSection(null);
      setHydratedIdentity(manifestIdentity);
    }
  }, [data, dirty, hydratedIdentity, id, isFetching, manifestIdentity, user?.name]);

  const save = useSaveTripManifest({
    mutation: {
      onSuccess: (manifest) => {
        setDirty(false);
        setFeedback(reviewAfterSave.current ? '' : 'Passenger information saved.');
        queryClient.setQueryData(manifestQueryKey, manifest);
        queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
        queryClient.invalidateQueries({
          predicate: (query) =>
            typeof query.queryKey[0] === 'string' && query.queryKey[0].endsWith('/my-status'),
        });
        if (reviewAfterSave.current) setMode('review');
        reviewAfterSave.current = false;
      },
      onError: (err: any) => {
        reviewAfterSave.current = false;
        setFeedback(err?.data?.error || err?.message || 'Unable to save passenger information.');
      },
    },
  });
  const submit = useSubmitTripManifest({
    mutation: {
      onSuccess: (manifest) => {
        setFeedback('Passenger information submitted. Bluebird operations was notified.');
        queryClient.setQueryData(manifestQueryKey, manifest);
        queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
      },
      onError: (err: any) =>
        setFeedback(err?.data?.error || err?.message || 'Unable to submit passenger information.'),
    },
  });

  const updatePassenger = (index: number, field: keyof DraftPassenger, value: string) => {
    setDirty(true);
    setFeedback('');
    setPassengers((current) => current.map((passenger, passengerIndex) =>
      passengerIndex === index ? { ...passenger, [field]: value } : passenger));
  };
  const updatePet = (field: keyof PetDraft, value: string) => {
    setDirty(true);
    setFeedback('');
    setPet((current) => ({ ...current, [field]: formatMeasurementInput(value) }));
  };
  const addPassenger = (returnToEdit = false) => {
    if (!data || !canAddPassenger) return;
    setPassengers((current) => [...current, {
      passengerOrder: current.length + 1,
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      weightKg: '',
    }]);
    setDirty(true);
    setFeedback('');
    if (returnToEdit) {
      setMode('edit');
      setEditingSection('passengers');
    }
  };
  const removePassenger = (index: number) => {
    if (index === 0 || passengers.length === 1) return;
    setPassengers((current) => current
      .filter((_, passengerIndex) => passengerIndex !== index)
      .map((passenger, passengerIndex) => ({ ...passenger, passengerOrder: passengerIndex + 1 })));
    setDirty(true);
    setFeedback('');
  };

  const validMeasurement = (value: string, maximum: number) => {
    const measurement = Number(value);
    return Number.isFinite(measurement) && measurement > 0 && measurement <= maximum;
  };
  const passengerComplete = (passenger: DraftPassenger) =>
    !!passenger.firstName.trim() &&
    !!passenger.lastName.trim() &&
    validPastDate(passenger.dateOfBirth) &&
    validMeasurement(passenger.weightKg, 500);
  const completedCount = passengers.filter(passengerComplete).length;
  const passengersComplete = passengers.length === data?.requiredCount && completedCount === passengers.length;
  const petComplete = !data?.bringingPet ||
    (validMeasurement(pet.weightLb, 500) &&
      validMeasurement(pet.crateLengthIn, 200) &&
      validMeasurement(pet.crateWidthIn, 200) &&
      validMeasurement(pet.crateHeightIn, 200));
  const allComplete = passengersComplete && petComplete;
  const optionalMeasurement = (value: string) => value ? Number(value) : null;
  const payload = () => ({
    passengers: passengers.map((passenger, index) => ({
      passengerOrder: index + 1,
      firstName: passenger.firstName,
      lastName: passenger.lastName,
      dateOfBirth: passenger.dateOfBirth || null,
      weightKg: optionalMeasurement(passenger.weightKg),
    })),
    ...(data?.bringingPet ? {
      pet: {
        weightLb: optionalMeasurement(pet.weightLb),
        crateLengthIn: optionalMeasurement(pet.crateLengthIn),
        crateWidthIn: optionalMeasurement(pet.crateWidthIn),
        crateHeightIn: optionalMeasurement(pet.crateHeightIn),
      },
    } : {}),
  });
  const pending = save.isPending || submit.isPending;

  const handleSave = () => {
    reviewAfterSave.current = false;
    save.mutate({ id: id!, data: payload() });
  };
  const handleReview = () => {
    if (!allComplete || pending) return;
    reviewAfterSave.current = true;
    save.mutate({ id: id!, data: payload() });
  };
  const edit = (section: 'passengers' | 'pet') => {
    setEditingSection(section);
    setFeedback('');
    setMode('edit');
  };

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (isError || !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="lock" size={24} color={colors.mutedForeground} />
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>Passenger information unavailable</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
          {(error as any)?.data?.error || 'Only confirmed upcoming trips can access this information.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <KeyboardAwareScrollViewCompat
        style={styles.root}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 140,
        }}
        bottomOffset={70}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.hero, { backgroundColor: colors.backgroundMid }]}>
          <Text style={[styles.eyebrow, { color: colors.mutedOnBrand }]}>
            {mode === 'review' ? 'FINAL CHECK' : 'FLIGHT OPERATIONS'}
          </Text>
          <Text style={[styles.heading, { color: colors.textOnBrand }]}>
            {mode === 'review' ? 'Review Information' : 'Passenger Information'}
          </Text>
          <Text style={[styles.progress, { color: colors.paleBlueFaint }]}>
            {mode === 'review'
              ? 'Confirm everything is correct before sending it to operations.'
              : `${completedCount} of ${passengers.length} travelers completed`}
          </Text>
        </View>

        {mode === 'review' ? (
          <>
            <ReviewSection title="Passengers" onEdit={() => edit('passengers')} colors={colors}>
              {passengers.map((passenger, index) => (
                <View key={passenger.passengerOrder} style={[styles.summaryRow, index > 0 && { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={[styles.summaryIcon, { backgroundColor: colors.primary + '14' }]}>
                    <Feather name="user" size={16} color={colors.primary} />
                  </View>
                  <View style={styles.summaryCopy}>
                    <Text style={[styles.summaryTitle, { color: colors.textOnSurface }]}>
                      {passenger.firstName.trim()} {passenger.lastName.trim()}
                    </Text>
                    <Text style={[styles.summaryDetail, { color: colors.mutedForegroundLight }]}>
                      Date of birth · {formatDateOfBirth(passenger.dateOfBirth)}
                    </Text>
                    <Text style={[styles.summaryDetail, { color: colors.mutedForegroundLight }]}>
                      Weight · {passenger.weightKg} kg
                    </Text>
                  </View>
                </View>
              ))}
            </ReviewSection>
            {data.bringingPet && (
              <ReviewSection title="Pet" onEdit={() => edit('pet')} colors={colors}>
                <View style={styles.summaryRow}>
                  <View style={[styles.summaryIcon, { backgroundColor: colors.primary + '14' }]}>
                    <Feather name="heart" size={16} color={colors.primary} />
                  </View>
                  <View style={styles.summaryCopy}>
                    <Text style={[styles.summaryTitle, { color: colors.textOnSurface }]}>{pet.weightLb} lb</Text>
                    <Text style={[styles.summaryDetail, { color: colors.mutedForegroundLight }]}>
                      Crate · {pet.crateLengthIn} × {pet.crateWidthIn} × {pet.crateHeightIn} in
                    </Text>
                  </View>
                </View>
              </ReviewSection>
            )}
            <View style={[styles.privacyNote, { backgroundColor: colors.primary + '0D' }]}>
              <Feather name="shield" size={16} color={colors.primary} />
              <Text style={[styles.privacyText, { color: colors.mutedForegroundLight }]}>
                Passport and travel-document information is not collected in this flow.
              </Text>
            </View>
          </>
        ) : (
          <>
            {!!editingSection && (
              <Text style={[styles.editHint, { color: colors.mutedForegroundLight }]}>
                Editing {editingSection === 'pet' ? 'pet details' : 'passenger details'}
              </Text>
            )}
            {editingSection !== 'pet' && passengers.map((passenger, index) => (
              <View
                key={passenger.passengerOrder}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: passengerComplete(passenger) ? colors.success : colors.border }]}
              >
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={[styles.slot, { color: colors.mutedForegroundLight }]}>TRAVELER {index + 1}</Text>
                    <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>
                      {passenger.firstName || passenger.lastName
                        ? `${passenger.firstName} ${passenger.lastName}`.trim()
                        : index === 0 ? 'Primary traveler' : 'Additional traveler'}
                    </Text>
                  </View>
                  {index > 0 ? (
                    <TouchableOpacity
                      testID={`remove-passenger-${index + 1}`}
                      onPress={() => removePassenger(index)}
                      accessibilityLabel={`Remove traveler ${index + 1}`}
                    >
                      <Feather name="trash-2" size={18} color={colors.destructive} />
                    </TouchableOpacity>
                  ) : (
                    <Feather name={passengerComplete(passenger) ? 'check-circle' : 'circle'} size={20} color={passengerComplete(passenger) ? colors.success : colors.mutedForegroundLight} />
                  )}
                </View>
                <View style={styles.row}>
                  <Field testID={`passenger-${index + 1}-first-name`} label="First name" value={passenger.firstName} onChangeText={(value: string) => updatePassenger(index, 'firstName', value)} colors={colors} />
                  <Field testID={`passenger-${index + 1}-last-name`} label="Last name" value={passenger.lastName} onChangeText={(value: string) => updatePassenger(index, 'lastName', value)} colors={colors} />
                </View>
                <Field
                  label="Date of birth (YYYY-MM-DD)"
                  testID={`passenger-${index + 1}-date-of-birth`}
                  value={passenger.dateOfBirth}
                  onChangeText={(value: string) => updatePassenger(index, 'dateOfBirth', formatDateInput(value))}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  colors={colors}
                />
                {!!passenger.dateOfBirth && !validPastDate(passenger.dateOfBirth) && (
                  <Text style={[styles.validation, { color: colors.destructive }]}>Enter a valid date in the past.</Text>
                )}
                <Field
                  label="Weight (kg)"
                  testID={`passenger-${index + 1}-weight-kg`}
                  value={passenger.weightKg}
                  onChangeText={(value: string) => updatePassenger(index, 'weightKg', formatMeasurementInput(value))}
                  keyboardType="decimal-pad"
                  colors={colors}
                />
                <Text style={[styles.validation, { color: colors.destructive }]}>
                  {passenger.weightKg
                    ? !validMeasurement(passenger.weightKg, 500) && 'Weight must be between 1 and 500 kg.'
                    : 'Weight is required (1–500 kg).'}
                </Text>
              </View>
            ))}
            {editingSection !== 'pet' && canAddPassenger && (
              <TouchableOpacity
                testID="add-passenger"
                style={[styles.addButton, { borderColor: colors.border }]}
                onPress={() => addPassenger()}
              >
                <Feather name="plus" size={17} color={colors.primary} />
                <Text style={[styles.addButtonText, { color: colors.primary }]}>Add Passenger</Text>
                <Text style={[styles.addLimit, { color: colors.mutedForegroundLight }]}>
                  Up to {humanPassengerLimit} traveler{humanPassengerLimit === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            )}
            {editingSection !== 'pet' && !canAddPassenger && (
              <Text style={[styles.capacityHint, { color: colors.mutedForegroundLight }]}>
                {capacityGuidance}
              </Text>
            )}
            {data.bringingPet && editingSection !== 'passengers' && (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: petComplete ? colors.success : colors.border }]}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={[styles.slot, { color: colors.mutedForegroundLight }]}>PET</Text>
                    <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>Travel crate details</Text>
                  </View>
                  <Feather name={petComplete ? 'check-circle' : 'circle'} size={20} color={petComplete ? colors.success : colors.mutedForegroundLight} />
                </View>
                <Field testID="pet-weight-lb" label="Weight (lb)" value={pet.weightLb} onChangeText={(value: string) => updatePet('weightLb', value)} keyboardType="number-pad" colors={colors} />
                <Text style={[styles.label, { color: colors.mutedForegroundLight }]}>Crate dimensions (inches)</Text>
                <View style={styles.measurementRow}>
                  <Field testID="pet-crate-length" label="Length" value={pet.crateLengthIn} onChangeText={(value: string) => updatePet('crateLengthIn', value)} keyboardType="number-pad" colors={colors} />
                  <Field testID="pet-crate-width" label="Width" value={pet.crateWidthIn} onChangeText={(value: string) => updatePet('crateWidthIn', value)} keyboardType="number-pad" colors={colors} />
                  <Field testID="pet-crate-height" label="Height" value={pet.crateHeightIn} onChangeText={(value: string) => updatePet('crateHeightIn', value)} keyboardType="number-pad" colors={colors} />
                </View>
                {Object.values(pet).some(Boolean) && !petComplete && (
                  <Text style={[styles.validation, { color: colors.destructive }]}>
                    Weight must be 1–500 lb. Each crate dimension must be 1–200 in.
                  </Text>
                )}
              </View>
            )}
          </>
        )}
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.footer, {
        backgroundColor: colors.surface,
        borderTopColor: colors.separator,
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 12,
      }]}>
        {!!feedback && (
          <Text style={[styles.feedback, { color: feedback.includes('Unable') ? colors.destructive : colors.success }]}>
            {feedback}
          </Text>
        )}
        {mode === 'review' ? (
          <TouchableOpacity
            testID="add-passenger-review"
            disabled={!canAddPassenger || pending}
            style={[styles.reviewAddButton, { borderColor: colors.primary }, (!canAddPassenger || pending) && styles.disabled]}
            onPress={() => addPassenger(true)}
          >
            <Feather name="plus" size={17} color={colors.primary} />
            <Text style={[styles.reviewAddButtonText, { color: colors.primary }]}>Add Passenger</Text>
          </TouchableOpacity>
        ) : null}
        {mode === 'review' && !canAddPassenger && (
          <Text style={[styles.capacityHint, { color: colors.mutedForegroundLight }]}>
            {capacityGuidance}
          </Text>
        )}
        {mode === 'review' ? (
          <TouchableOpacity
            testID="submit-passenger-list"
            disabled={!allComplete || pending || !!data.submittedAt}
            style={[styles.primary, { backgroundColor: colors.primary }, (!allComplete || pending || !!data.submittedAt) && styles.disabled]}
            onPress={() => submit.mutate({ id: id! })}
          >
            {submit.isPending
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
                  {data.submittedAt ? 'Submitted' : data.version ? 'Submit Updated Information' : 'Submit to Operations'}
                </Text>}
          </TouchableOpacity>
        ) : (
          <View style={styles.footerRow}>
            <TouchableOpacity
              testID="save-passenger-list"
              disabled={pending}
              style={[styles.secondary, { borderColor: colors.border }, pending && styles.disabled]}
              onPress={handleSave}
            >
              <Text style={[styles.secondaryText, { color: colors.textOnSurface }]}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="review-passenger-list"
              disabled={!allComplete || pending}
              style={[styles.primary, { backgroundColor: colors.primary }, (!allComplete || pending) && styles.disabled]}
              onPress={handleReview}
            >
              {save.isPending && reviewAfterSave.current
                ? <ActivityIndicator color={colors.primaryForeground} />
                : <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>Review Information</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

function validPastDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && date < new Date();
}

function formatDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join('-');
}

function formatMeasurementInput(value: string) {
  const normalized = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...fractionParts] = normalized.split('.');
  return fractionParts.length ? `${whole}.${fractionParts.join('')}` : whole;
}

function formatDateOfBirth(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function ReviewSection({ title, onEdit, colors, children }: any) {
  return (
    <View style={[styles.reviewCard, { backgroundColor: colors.surface }]}>
      <View style={styles.reviewHeader}>
        <Text style={[styles.reviewTitle, { color: colors.textOnSurface }]}>{title}</Text>
        <TouchableOpacity onPress={onEdit} testID={`edit-${String(title).toLowerCase()}`}>
          <Text style={[styles.editText, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

function Field({ label, colors, ...props }: any) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.mutedForegroundLight}
        style={[styles.input, { backgroundColor: colors.input, color: colors.textOnSurface, borderColor: colors.border }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, marginTop: 12 },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 6 },
  hero: { borderRadius: 22, padding: 20, marginBottom: 16 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 8 },
  progress: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20, marginTop: 5 },
  editHint: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 10 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  slot: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 3 },
  row: { flexDirection: 'row', gap: 10 },
  measurementRow: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, marginBottom: 12 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 46, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  validation: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: -5, marginBottom: 6 },
  addButton: { minHeight: 48, borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  addButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  addLimit: { marginLeft: 'auto', fontFamily: 'Inter_400Regular', fontSize: 12 },
  capacityHint: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18, textAlign: 'center', marginBottom: 12 },
  reviewAddButton: { minHeight: 48, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  reviewAddButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  reviewCard: { borderRadius: 16, padding: 16, marginBottom: 12 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reviewTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  editText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  summaryIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  summaryCopy: { flex: 1 },
  summaryTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  summaryDetail: { fontFamily: 'Inter_400Regular', fontSize: 12.5, marginTop: 3 },
  privacyNote: { borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  privacyText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  feedback: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', marginBottom: 8 },
  footerRow: { flexDirection: 'row', gap: 10 },
  secondary: { minHeight: 48, paddingHorizontal: 24, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  primary: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  disabled: { opacity: 0.42 },
});
