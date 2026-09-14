import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateSavedPassenger,
  useDeleteSavedPassenger,
  useListSavedPassengers,
  useUpdateSavedPassenger,
  type SavedPassenger,
  type SavedPassengerInput,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { confirmDialog } from '@/lib/confirmDialog';

type FormState = SavedPassengerInput;
const EMPTY_FORM: FormState = { firstName: '', lastName: '', phone: '', email: '', weightKg: 70 };

function errorMessage(error: any, fallback: string) {
  return error?.data?.error || error?.response?.data?.error || error?.message || fallback;
}

export default function PassengersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const memberKey = user?.id ?? 'signed-out';
  const passengersQueryKey = ['/api/passengers', memberKey] as const;
  const { data, isLoading, isFetching, isError, error, refetch } = useListSavedPassengers({
    query: {
      enabled: !!user,
      queryKey: passengersQueryKey,
    },
  });
  const [editing, setEditing] = React.useState<SavedPassenger | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = React.useState('');
  const [feedback, setFeedback] = React.useState('');

  const closeForm = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
  };
  const openAdd = () => {
    setFeedback('');
    setForm(EMPTY_FORM);
    setFormError('');
    setEditing({ id: '', firstName: '', lastName: '', phone: null, email: null, weightKg: 70, createdAt: '', updatedAt: '' });
  };
  const openEdit = (passenger: SavedPassenger) => {
    setFeedback('');
    setForm({
      firstName: passenger.firstName,
      lastName: passenger.lastName,
      phone: passenger.phone ?? '',
      email: passenger.email ?? '',
      weightKg: passenger.weightKg,
    });
    setFormError('');
    setEditing(passenger);
  };
  const setField = (field: keyof FormState, value: string | number) =>
    setForm((current) => ({ ...current, [field]: value }));

  const saveMutation = useCreateSavedPassenger({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: passengersQueryKey });
        setFeedback('Passenger saved.');
        closeForm();
      },
      onError: (err) => setFormError(errorMessage(err, 'Unable to save passenger.')),
    },
  });
  const updateMutation = useUpdateSavedPassenger({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: passengersQueryKey });
        setFeedback('Passenger updated.');
        closeForm();
      },
      onError: (err) => setFormError(errorMessage(err, 'Unable to update passenger.')),
    },
  });
  const deleteMutation = useDeleteSavedPassenger({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: passengersQueryKey });
        setFeedback('Passenger removed.');
      },
      onError: (err) => setFeedback(errorMessage(err, 'Unable to remove passenger.')),
    },
  });

  const validate = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) return 'First and last name are required.';
    const weight = Number(form.weightKg);
    if (!Number.isFinite(weight) || weight < 1 || weight > 500) return 'Weight must be between 1 and 500 kg.';
    if (form.email?.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return 'Enter a valid email address.';
    return '';
  };
  const submit = () => {
    const message = validate();
    setFormError(message);
    if (message) return;
    const payload: SavedPassengerInput = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      weightKg: Number(form.weightKg),
    };
    if (editing?.id) updateMutation.mutate({ id: editing.id, data: payload });
    else saveMutation.mutate({ data: payload });
  };

  const passengers = data ?? [];
  const pending = saveMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const bottomPad = (Platform.OS === 'web' ? 34 : insets.bottom) + 36;

  if (isLoading || !user) {
    return <View style={[styles.center, { backgroundColor: colors.offWhite }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.offWhite, paddingHorizontal: 28 }]}>
        <Feather name="alert-circle" size={26} color={colors.destructive} />
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>Passengers could not load</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>{errorMessage(error, 'Please try again.')}</Text>
        <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={() => refetch()}>
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]} showsVerticalScrollIndicator={false}>
        <View style={styles.introRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.introTitle, { color: colors.textOnSurface }]}>Your passenger library</Text>
            <Text style={[styles.intro, { color: colors.mutedForegroundLight }]}>
              Save traveler details once and reuse them for confirmed trips. Date of birth stays specific to each flight.
            </Text>
          </View>
          <TouchableOpacity testID="add-saved-passenger" style={[styles.addCircle, { backgroundColor: colors.primary }]} onPress={openAdd}>
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>

        {!!feedback && <Text style={[styles.feedback, { color: feedback.includes('Unable') ? colors.destructive : colors.success }]}>{feedback}</Text>}
        {isFetching && <ActivityIndicator style={styles.smallSpinner} color={colors.primary} />}
        {passengers.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.primary + '14' }]}>
              <Feather name="users" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.textOnSurface }]}>No saved passengers yet</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForegroundLight }]}>
              Add a traveler to fill in passenger information faster next time.
            </Text>
            <TouchableOpacity testID="empty-add-saved-passenger" style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={openAdd}>
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Add passenger</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {passengers.map((passenger, index) => (
              <View key={passenger.id} style={[styles.passengerRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.separator }]}>
                <View style={[styles.avatar, { backgroundColor: colors.backgroundMid }]}>
                  <Text style={[styles.avatarText, { color: colors.textOnBrand }]}>
                    {(passenger.firstName[0] + passenger.lastName[0]).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.passengerCopy}>
                  <Text style={[styles.passengerName, { color: colors.textOnSurface }]}>{passenger.firstName} {passenger.lastName}</Text>
                  <Text style={[styles.passengerDetail, { color: colors.mutedForegroundLight }]}>
                    {passenger.weightKg} kg{passenger.phone ? ` · ${passenger.phone}` : ''}{passenger.email ? ` · ${passenger.email}` : ''}
                  </Text>
                </View>
                <TouchableOpacity testID={`edit-saved-passenger-${passenger.id}`} onPress={() => openEdit(passenger)} style={styles.iconButton}>
                  <Feather name="edit-2" size={17} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`delete-saved-passenger-${passenger.id}`}
                  onPress={async () => {
                    const confirmed = await confirmDialog('Remove passenger?', `Remove ${passenger.firstName} ${passenger.lastName} from your passenger library?`, 'Remove', true);
                    if (confirmed) deleteMutation.mutate({ id: passenger.id });
                  }}
                  style={styles.iconButton}
                  disabled={pending}
                >
                  <Feather name="trash-2" size={17} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={closeForm}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textOnSurface }]}>{editing?.id ? 'Edit passenger' : 'Add passenger'}</Text>
              <TouchableOpacity onPress={closeForm} disabled={pending}><Feather name="x" size={22} color={colors.mutedForegroundLight} /></TouchableOpacity>
            </View>
            {(['firstName', 'lastName', 'phone', 'email'] as const).map((field) => (
              <View key={field} style={styles.field}>
                <Text style={[styles.label, { color: colors.mutedForegroundLight }]}>
                  {field === 'firstName' ? 'First name' : field === 'lastName' ? 'Last name' : field === 'phone' ? 'Phone (optional)' : 'Email (optional)'}
                </Text>
                <TextInput
                  testID={`saved-passenger-${field}`}
                  value={String(form[field] ?? '')}
                  onChangeText={(value) => setField(field, value)}
                  placeholder={field === 'email' ? 'traveler@example.com' : field === 'phone' ? '+1 555 555 5555' : ''}
                  placeholderTextColor={colors.mutedForegroundLight}
                  keyboardType={field === 'email' ? 'email-address' : field === 'phone' ? 'phone-pad' : 'default'}
                  autoCapitalize={field === 'email' ? 'none' : 'words'}
                  style={[styles.input, { backgroundColor: colors.input, color: colors.textOnSurface, borderColor: colors.border }]}
                />
              </View>
            ))}
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.mutedForegroundLight }]}>Weight (kg)</Text>
              <TextInput
                testID="saved-passenger-weight-kg"
                value={String(form.weightKg ?? '')}
                onChangeText={(value) => setField('weightKg', value.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                style={[styles.input, { backgroundColor: colors.input, color: colors.textOnSurface, borderColor: colors.border }]}
              />
            </View>
            {!!formError && <Text style={[styles.formError, { color: colors.destructive }]}>{formError}</Text>}
            <TouchableOpacity testID="save-saved-passenger" style={[styles.primaryButton, { backgroundColor: colors.primary }, pending && styles.disabled]} onPress={submit} disabled={pending}>
              {pending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{editing?.id ? 'Save changes' : 'Save passenger'}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  introRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  introTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 5 },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19 },
  addCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  feedback: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12 },
  smallSpinner: { alignSelf: 'flex-start', marginBottom: 10 },
  card: { borderRadius: 18, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 11 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  passengerCopy: { flex: 1, minWidth: 0 },
  passengerName: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  passengerDetail: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  iconButton: { padding: 7 },
  emptyCard: { borderRadius: 18, padding: 24, alignItems: 'center' },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginTop: 6, marginBottom: 18 },
  primaryButton: { minHeight: 46, borderRadius: 999, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  retryButton: { marginTop: 16, minHeight: 44, borderRadius: 999, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  errorTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 10 },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'web' ? 30 : 32 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  field: { marginBottom: 12 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  formError: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12 },
  disabled: { opacity: 0.55 },
});