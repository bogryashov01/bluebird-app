import React from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { PassengerForm } from '@/components/PassengerForm';
import { SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import {
  createMainBluebirdApiIntegration,
  mainBluebirdAuthenticatedQueryKey,
} from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  ProductionAuthHttpError,
  type ProductionEmptyLegPassengerList,
  type ProductionPassenger,
  type ProductionTrip,
} from '@/lib/productionAuthApi';
import { parseProductionFlightId } from '@/lib/productionFlights';
import { isNativeProductionAuthTestEnabled } from '@/lib/nativeAuthTestPolicy';
import {
  PASSENGER_RECORDED,
  PASSENGER_REMOVE_UNAVAILABLE,
  PASSENGER_REMOVED,
  PASSENGER_SAVE_UNAVAILABLE,
  PASSENGER_UPDATED,
  additionalPassengerOffer,
  displayPassengerName,
  emptyPassengerForm,
  manifestMatchesFlight,
  passengerFormFromRecord,
  presentPassengerFailure,
  presentPassengerRoster,
  presentPetSummary,
  resolvePassengerManifestAccess,
  reviewCreateProductionPassenger,
  reviewDeleteProductionPassenger,
  reviewUpdateProductionPassenger,
  canCreateProductionPassenger,
  canDeleteProductionPassenger,
  canUpdateProductionPassenger,
  shouldApplyPassengerManifest,
  type PassengerFormErrors,
  type PassengerFormValues,
} from '@/lib/passengerManifest';
import { usePassengerActions } from '@/lib/usePassengerActions';
import {
  CHECKLIST_BACK_TO_TRIPS_LABEL,
  PASSENGER_DETAILS_UNAVAILABLE_NOTE,
  TripChecklistMismatchError,
  TripChecklistSessionError,
  shouldApplyTripChecklist,
  tripMatchesFlight,
} from '@/lib/winnerChecklist';

type Editor =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; passengerId: number; title: string };

let passengerBackLock = false;

export default function FlightPassengersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ legId?: string }>();
  const legId = parseProductionFlightId(params.legId);
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const queryClient = useQueryClient();
  const passengerActions = usePassengerActions(legId ?? 0);
  const previousUserId = React.useRef<string | null>(null);
  const [editor, setEditor] = React.useState<Editor>({ mode: 'list' });
  const [values, setValues] = React.useState<PassengerFormValues>(emptyPassengerForm());
  const [errors, setErrors] = React.useState<PassengerFormErrors>({});
  const [notice, setNotice] = React.useState<string | null>(null);

  const environment = configuration?.environment ?? null;
  const activeUserId = session?.isSignedIn === true ? session.userId : null;
  const seenScope = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    const previous = previousUserId.current;
    if (previous && previous !== activeUserId && environment && legId !== null) {
      queryClient.removeQueries({
        queryKey: mainBluebirdAuthenticatedQueryKey(environment, previous, 'empty-leg-passengers', legId),
      });
      queryClient.removeQueries({
        queryKey: mainBluebirdAuthenticatedQueryKey(environment, previous, 'trip', legId),
      });
    }
    previousUserId.current = activeUserId;
  }, [activeUserId, environment, legId, queryClient]);

  React.useEffect(() => {
    const scope = `${activeUserId ?? ''}:${legId ?? ''}`;
    if (seenScope.current !== undefined && seenScope.current !== scope) {
      setEditor({ mode: 'list' });
      setValues(emptyPassengerForm());
      setErrors({});
      setNotice(null);
    }
    seenScope.current = scope;
  }, [activeUserId, legId]);

  const ready = legId !== null &&
    authMode === 'clerk' &&
    !!configuration &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    !!session.userId &&
    session.userId === clerkUserId;

  const authTest = isNativeProductionAuthTestEnabled();
  const tripQuery = useQuery<ProductionTrip>({
    queryKey: configuration && clerkUserId && legId !== null
      ? mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trip', legId)
      : ['main-bluebird-api', configuration?.environment ?? 'unconfigured', clerkUserId ?? 'signed-out', 'trip', legId ?? 'invalid'],
    enabled: ready && !authTest,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      if (!configuration || legId === null || !session?.userId || !ready) {
        throw new TripChecklistSessionError();
      }
      const requestedUserId = session.userId;
      const requestedLegId = legId;
      const tokenProvider = createClerkProductionTokenProvider({
        getCurrentSession: () => {
          const current = sessionRef.current;
          if (!current || current.userId !== requestedUserId) {
            return {
              isLoaded: true,
              isSignedIn: false,
              getToken: async () => null,
              signOut: async () => {},
            };
          }
          return current as ClerkSessionSnapshot;
        },
      }, configuration.environment);
      const api = createMainBluebirdApiIntegration({ configuration, tokenProvider });
      const trip = await api.authenticated.getTrip(requestedLegId, { signal });
      const current = sessionRef.current;
      if (!shouldApplyTripChecklist({
        requestedUserId,
        activeUserId: current?.isSignedIn === true ? current.userId : null,
        signedIn: current?.isSignedIn === true,
      })) {
        throw new TripChecklistSessionError();
      }
      if (!tripMatchesFlight(trip, requestedLegId)) throw new TripChecklistMismatchError();
      return trip;
    },
  });

  const query = useQuery<ProductionEmptyLegPassengerList>({
    queryKey: configuration && clerkUserId && legId !== null
      ? mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'empty-leg-passengers', legId)
      : ['main-bluebird-api', configuration?.environment ?? 'unconfigured', clerkUserId ?? 'signed-out', 'empty-leg-passengers', legId ?? 'invalid'],
    enabled: ready && !authTest,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      if (!configuration || legId === null || !session?.userId || !ready) {
        throw new Error('A signed-in Clerk session is required.');
      }
      const requestedUserId = session.userId;
      const requestedLegId = legId;
      const tokenProvider = createClerkProductionTokenProvider({
        getCurrentSession: () => {
          const current = sessionRef.current;
          if (!current || current.userId !== requestedUserId) {
            return {
              isLoaded: true,
              isSignedIn: false,
              getToken: async () => null,
              signOut: async () => {},
            };
          }
          return current as ClerkSessionSnapshot;
        },
      }, configuration.environment);
      const api = createMainBluebirdApiIntegration({ configuration, tokenProvider });
      const manifest = await api.authenticated.getEmptyLegPassengers(requestedLegId, { signal });
      const current = sessionRef.current;
      if (!shouldApplyPassengerManifest({
        requestedUserId,
        activeUserId: current?.isSignedIn === true ? current.userId : null,
        signedIn: current?.isSignedIn === true,
      })) {
        throw new Error('The signed-in account changed.');
      }
      if (!manifestMatchesFlight([...manifest.passengers, ...manifest.pets], requestedLegId)) {
        throw new Error('This manifest does not match the opened flight.');
      }
      return manifest;
    },
  });

  if (legId === null) {
    return <Message title="Flight unavailable" body="This flight is no longer available." colors={colors} />;
  }
  if (!session?.isLoaded || authMode !== 'clerk') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!ready) {
    const failure = !configuration
      ? { title: 'Passenger information unavailable', body: 'Passenger information is unavailable right now.' }
      : presentPassengerFailure(401);
    return <Message title={failure.title} body={failure.body} colors={colors} />;
  }
  if (authTest) {
    return (
      <Message
        title="Passenger information unavailable"
        body={PASSENGER_DETAILS_UNAVAILABLE_NOTE}
        colors={colors}
        actionLabel={CHECKLIST_BACK_TO_TRIPS_LABEL}
        buttonTestID="passengers-back-to-trips"
        onAction={() => {
          if (passengerBackLock) return;
          passengerBackLock = true;
          if (router.canGoBack()) router.back();
          else router.replace('/(tabs)/trips');
          setTimeout(() => {
            passengerBackLock = false;
          }, 600);
        }}
      />
    );
  }
  const manifestAccess = resolvePassengerManifestAccess({
    legId,
    signedIn: session?.isSignedIn === true,
    activeUserId,
    accountUserId: clerkUserId,
    phase: tripQuery.isPending || tripQuery.isLoading
      ? 'pending'
      : tripQuery.isError || !tripQuery.data
        ? 'error'
        : 'success',
    trip: tripQuery.data ?? null,
  });
  if (manifestAccess === 'loading') {
    return (
      <View testID="passengers-loading" style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (manifestAccess === 'error') {
    const failure = tripQuery.error instanceof ProductionAuthHttpError
      ? presentPassengerFailure(tripQuery.error.status)
      : { title: 'Passenger information unavailable', body: 'This flight could not be loaded. Nothing was changed.' };
    const canRetry = !(tripQuery.error instanceof ProductionAuthHttpError &&
      [400, 401, 403, 404, 409].includes(tripQuery.error.status)) &&
      !(tripQuery.error instanceof TripChecklistMismatchError);
    return (
      <Message
        title={failure.title}
        body={failure.body}
        colors={colors}
        actionLabel={canRetry ? 'Try Again' : undefined}
        onAction={canRetry ? () => { void tripQuery.refetch(); } : undefined}
      />
    );
  }
  const locked = manifestAccess !== 'unlocked';
  if (query.isPending || query.isLoading) {
    return (
      <View testID="passengers-loading" style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (query.isError || !query.data) {
    const failure = query.error instanceof ProductionAuthHttpError
      ? presentPassengerFailure(query.error.status)
      : presentPassengerFailure(null);
    const canRetry = !(query.error instanceof ProductionAuthHttpError) ||
      ![400, 401, 403, 404, 409].includes(query.error.status);
    return (
      <Message
        title={failure.title}
        body={failure.body}
        colors={colors}
        actionLabel={canRetry ? 'Try Again' : undefined}
        onAction={canRetry ? () => { void query.refetch(); } : undefined}
      />
    );
  }

  const manifest = query.data;
  const roster = presentPassengerRoster(manifest.passengers);
  const offer = additionalPassengerOffer({
    passengerCount: manifest.passengers.length,
    guestCount: roster.guests.length,
    passengerCap: manifest.passengerCap,
    manifestLocked: manifestAccess === 'locked' ? true : manifestAccess === 'unlocked' ? false : null,
  });
  const petSummary = presentPetSummary(manifest.pets.length);
  const openCreate = () => {
    if (!offer.allowed) return;
    setValues(emptyPassengerForm());
    setErrors({});
    setNotice(null);
    setEditor({ mode: 'create' });
  };
  const openEdit = (passenger: ProductionPassenger, title: string) => {
    if (locked) return;
    setValues(passengerFormFromRecord(passenger));
    setErrors({});
    setNotice(null);
    setEditor({ mode: 'edit', passengerId: passenger.id, title });
  };
  const describe = (failure: { title: string; body: string }) => `${failure.title}. ${failure.body}`;
  const onSave = () => {
    const decision = editor.mode === 'edit'
      ? reviewUpdateProductionPassenger(legId, editor.passengerId, values)
      : reviewCreateProductionPassenger(legId, values);
    if (decision.status === 'invalid') {
      setErrors(decision.errors);
      setNotice(null);
      return;
    }
    setErrors({});
    if (decision.status !== 'ready') return setNotice(PASSENGER_SAVE_UNAVAILABLE);
    const requestedUserId = sessionRef.current?.userId ?? '';
    void (async () => {
      const outcome = editor.mode === 'edit'
        ? await passengerActions.updatePassenger({
          passengerId: editor.passengerId,
          values,
          editsLocked: locked,
          passengerPresent: manifest.passengers.some((row) => row.id === editor.passengerId),
        })
        : await passengerActions.createPassenger({
          values,
          editsLocked: locked,
          passengerCount: manifest.passengers.length,
          guestCount: roster.guests.length,
          passengerCap: manifest.passengerCap,
        });
      if (sessionRef.current?.userId !== requestedUserId) return;
      if (!outcome || outcome.status === 'disabled' || outcome.status === 'needs-confirmation') return;
      if (outcome.status === 'invalid') {
        setErrors(outcome.errors);
        setNotice(null);
        return;
      }
      if (outcome.status === 'saved') {
        setEditor({ mode: 'list' });
        setValues(emptyPassengerForm());
        setErrors({});
        setNotice(editor.mode === 'edit' ? PASSENGER_UPDATED : PASSENGER_RECORDED);
        return;
      }
      if (outcome.status === 'failed' || outcome.status === 'duplicate') setNotice(describe(outcome.failure));
    })();
  };
  const onRemove = (passenger: ProductionPassenger) => {
    if (passenger.isAccountHolder || locked || !canDeleteProductionPassenger()) return;
    Alert.alert(
      'Remove this passenger?',
      'This removes the passenger from the flight.',
      [
        { text: 'Keep passenger', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const decision = reviewDeleteProductionPassenger(legId, passenger.id, passenger.isAccountHolder, true);
            if (decision.status !== 'ready') return;
            const requestedUserId = sessionRef.current?.userId ?? '';
            void (async () => {
              const outcome = await passengerActions.deletePassenger({
                passengerId: passenger.id,
                isAccountHolder: passenger.isAccountHolder,
                editsLocked: locked,
                passengerPresent: manifest.passengers.some((row) => row.id === passenger.id),
              });
              if (sessionRef.current?.userId !== requestedUserId) return;
              if (!outcome || outcome.status === 'disabled' || outcome.status === 'needs-confirmation') return;
              if (outcome.status === 'removed') {
                setNotice(PASSENGER_REMOVED);
                return;
              }
              if (outcome.status === 'failed' || outcome.status === 'duplicate') setNotice(describe(outcome.failure));
            })();
          },
        },
      ],
    );
  };

  return (
    <KeyboardAwareScrollViewCompat
      testID="flight-passengers"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Passenger Information</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Review your details and add the people traveling with you.
      </Text>
      {manifestAccess === 'locked' && (
        <Text testID="passengers-locked" style={[styles.note, { color: colors.foreground }]}>
          Passenger changes are locked.
        </Text>
      )}
      {manifestAccess === 'unknown' && (
        <Text testID="passengers-manifest-unknown" style={[styles.note, { color: colors.foreground }]}>
          Passenger changes are unavailable until Bluebird confirms whether this manifest is locked.
        </Text>
      )}
      {editor.mode === 'list' && !!notice && (
        <Text testID="passenger-action-notice" style={[styles.note, { color: colors.foreground }]}>
          {notice}
        </Text>
      )}
      {manifestAccess !== 'unknown' && (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{offer.reason}</Text>
      )}
      {editor.mode === 'list' ? (
        <View style={styles.stack}>
          <View testID="passenger-account-holder" style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Passenger 1 — You</Text>
            {roster.accountHolder ? (
              <PassengerFacts passenger={roster.accountHolder} colors={colors} />
            ) : (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                The account holder’s passenger record is not available for this flight.
              </Text>
            )}
            {roster.accountHolder && !locked && (
              <SecondaryButton
                label="Edit"
                testID="passenger-edit-account-holder"
                onPress={() => openEdit(roster.accountHolder as ProductionPassenger, 'Edit your details')}
              />
            )}
          </View>
          {roster.protectedPassengers.map((passenger) => (
            <View key={passenger.id} style={[styles.card, { backgroundColor: colors.card }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Account holder</Text>
              <PassengerFacts passenger={passenger} colors={colors} />
            </View>
          ))}
          <Text style={[styles.section, { color: colors.foreground }]}>Additional Passengers</Text>
          {roster.guests.length === 0 && (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>No additional passengers are recorded.</Text>
          )}
          {roster.guests.map((passenger) => (
            <View key={passenger.id} testID="passenger-guest" style={[styles.card, { backgroundColor: colors.card }]}>
              <PassengerFacts passenger={passenger} colors={colors} />
              {!locked && (
                <View style={styles.row}>
                  <SecondaryButton
                    label="Edit"
                    testID="passenger-edit-guest"
                    onPress={() => openEdit(passenger, 'Edit passenger')}
                    style={styles.rowButton}
                  />
                  <SecondaryButton
                    label="Remove"
                    testID="passenger-remove"
                    disabled={!canDeleteProductionPassenger() || locked}
                    loading={passengerActions.submitting}
                    onPress={() => onRemove(passenger)}
                    style={styles.rowButton}
                  />
                </View>
              )}
            </View>
          ))}
          {!canDeleteProductionPassenger() && (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>{PASSENGER_REMOVE_UNAVAILABLE}</Text>
          )}
          <SecondaryButton
            label="+ Add Passenger"
            testID="passenger-add"
            disabled={!offer.allowed}
            onPress={openCreate}
          />
          {!!petSummary && (
            <Text testID="passenger-pets" style={[styles.note, { color: colors.mutedForeground }]}>{petSummary}</Text>
          )}
        </View>
      ) : (
        <View style={styles.stack}>
          <PassengerForm
            title={editor.mode === 'create' ? 'Add passenger' : editor.title}
            values={values}
            errors={errors}
            notice={notice}
            writesOpen={editor.mode === 'edit' ? canUpdateProductionPassenger() : canCreateProductionPassenger()}
            loading={passengerActions.submitting}
            onChange={(next) => {
              setValues(next);
              setNotice(null);
            }}
            onSubmit={onSave}
          />
          <SecondaryButton
            label="Back to passengers"
            testID="passenger-form-back"
            onPress={() => {
              setEditor({ mode: 'list' });
              setValues(emptyPassengerForm());
              setErrors({});
              setNotice(null);
            }}
          />
        </View>
      )}
    </KeyboardAwareScrollViewCompat>
  );
}

function PassengerFacts({
  passenger,
  colors,
}: {
  passenger: ProductionPassenger;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.facts}>
      <Text style={[styles.name, { color: colors.foreground }]}>{displayPassengerName(passenger) || 'Name unavailable'}</Text>
      {[
        ['Date of birth', passenger.dob],
        ['Weight', passenger.weight === null ? 'Unavailable' : `${passenger.weight} lbs`],
        ['Gender', passenger.gender === 'male' ? 'Male' : passenger.gender === 'female' ? 'Female' : 'Unavailable'],
      ].map(([label, value]) => (
        <View key={label} style={styles.factRow}>
          <Text style={[styles.factLabel, { color: colors.mutedForeground }]}>{label}</Text>
          <Text style={[styles.meta, { color: colors.foreground }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function Message({
  title,
  body,
  colors,
  actionLabel,
  onAction,
  buttonTestID = 'passengers-retry',
}: {
  title: string;
  body: string;
  colors: ReturnType<typeof useColors>;
  actionLabel?: string;
  onAction?: () => void;
  buttonTestID?: string;
}) {
  return (
    <View testID="passengers-message" style={[styles.centered, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground, textAlign: 'center' }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: 'center' }]}>{body}</Text>
      {actionLabel && onAction ? (
        <SecondaryButton label={actionLabel} testID={buttonTestID} onPress={onAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21 },
  section: { fontFamily: 'Inter_700Bold', fontSize: 18, marginTop: 8 },
  card: { borderRadius: 18, padding: 16, gap: 10 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  facts: { gap: 8 },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  factLabel: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  stack: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  rowButton: { flex: 1 },
});
