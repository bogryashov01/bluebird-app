import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { mainBluebirdAuthenticatedQueryKey } from '@/lib/mainBluebirdApi';
import type { ProductionTrip } from '@/lib/productionAuthApi';
import {
  ProductionReadHttpError,
  ProductionReadInvalidJsonError,
  ProductionReadSchemaError,
  parseProductionFlightId,
} from '@/lib/productionFlights';
import { isNativeProductionAuthTestEnabled } from '@/lib/nativeAuthTestPolicy';
import {
  createPolicyReadState,
  fetchActiveFlightPolicy,
  measurePolicyScroll,
  policyAgreementScopeKey,
  presentFlightPolicyFailure,
  syncPolicyReadState,
  togglePolicyAgreement,
  type ActiveFlightPolicy,
} from '@/lib/flightPolicy';
import {
  canAcknowledgeProductionPolicy,
  policyActionBlock,
  reviewPolicyAcknowledgement,
  tripMatchesFlight,
} from '@/lib/winnerChecklist';
import { useWinnerActions } from '@/lib/useWinnerActions';

export default function FlightPolicyReviewScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ legId?: string }>();
  const legId = parseProductionFlightId(params.legId);
  const { clerkUserId } = useAuth();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const queryClient = useQueryClient();
  const winnerActions = useWinnerActions(legId ?? 0);
  const [metrics, setMetrics] = React.useState({
    viewportHeight: null as number | null,
    contentHeight: null as number | null,
    offsetY: null as number | null,
  });
  const [stored, setStored] = React.useState(createPolicyReadState());

  const authTest = isNativeProductionAuthTestEnabled();
  const query = useQuery<ActiveFlightPolicy>({
    queryKey: ['main-bluebird-api', configuration?.environment ?? 'unconfigured', 'public', 'flight-policy'],
    enabled: !!configuration && !authTest,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
    queryFn: ({ signal }) => fetchActiveFlightPolicy({ signal }),
  });

  const [metricsScope, setMetricsScope] = React.useState<string | null>(null);
  const policy = query.isSuccess ? query.data : null;
  const scopeKey = policy
    ? policyAgreementScopeKey({
      clerkUserId,
      legId,
      versionId: policy.versionId,
      body: policy.body,
    })
    : null;
  if (metricsScope !== scopeKey) {
    setMetricsScope(scopeKey);
    setMetrics({ viewportHeight: null, contentHeight: null, offsetY: null });
  }
  const activeMetrics = metricsScope === scopeKey
    ? metrics
    : { viewportHeight: null, contentHeight: null, offsetY: null };
  const scrollComplete = policy ? measurePolicyScroll(activeMetrics) : false;
  const read = syncPolicyReadState(stored, scopeKey, scrollComplete);
  const scopeRef = React.useRef<string | null>(null);
  scopeRef.current = scopeKey;
  const reviewedTrip = configuration && clerkUserId && legId !== null
    ? matchingTrip(
      queryClient.getQueryData<ProductionTrip>(
        mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trip', legId),
      ),
      legId,
    )
    : null;
  const acknowledgedOnServer = hasRecordedTime(reviewedTrip?.checklist.policyAckAt ?? null);
  const policyResultVisible = winnerActions.policyResultScope === scopeKey;

  if (authTest) {
    return (
      <Message
        title="Flight policy unavailable"
        body="The flight policy cannot be loaded in this build. Acknowledgement is not available. No request is sent."
        colors={colors}
      />
    );
  }
  if (!configuration) {
    return <Message title="Flight policy unavailable" body="The flight policy is unavailable right now." colors={colors} />;
  }
  if (query.isPending || query.isLoading) {
    return (
      <View testID="flight-policy-loading" style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (query.isError || !policy) {
    const failure = presentFlightPolicyFailure(failureKind(query.error));
    return (
      <Message
        title={failure.title}
        body={failure.body}
        colors={colors}
        actionLabel="Try Again"
        onAction={() => { void query.refetch(); }}
      />
    );
  }

  const canCheck = scrollComplete && scopeKey !== null;
  return (
    <View testID="flight-policy-review" style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Flight Policy</Text>
      <Text testID="flight-policy-version" style={[styles.version, { color: colors.mutedForeground }]}>
        Version: {policy.versionLabel}
      </Text>
      <ScrollView
        key={scopeKey ?? `policy-${policy.versionId}`}
        testID="flight-policy-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        scrollEventThrottle={16}
        onLayout={(event) => {
          const viewportHeight = event.nativeEvent.layout.height;
          setMetrics((current) => ({ ...current, viewportHeight }));
        }}
        onContentSizeChange={(_width, contentHeight) => {
          setMetrics((current) => ({ ...current, contentHeight }));
        }}
        onScroll={(event) => {
          const offsetY = event.nativeEvent.contentOffset.y;
          setMetrics((current) => ({ ...current, offsetY }));
        }}
      >
        <Text testID="flight-policy-body" style={[styles.body, { color: colors.foreground }]}>
          {policy.body}
        </Text>
      </ScrollView>
      <Pressable
        testID="flight-policy-agree"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: read.checked, disabled: !canCheck || acknowledgedOnServer }}
        disabled={!canCheck || acknowledgedOnServer}
        onPress={() => {
          setStored(togglePolicyAgreement(read, true, scrollComplete));
        }}
        style={styles.agreeRow}
      >
        <View style={[
          styles.box,
          { borderColor: colors.border },
          read.checked && { backgroundColor: colors.primary, borderColor: colors.primary },
        ]}
        />
        <Text style={[styles.agreeLabel, { color: canCheck ? colors.foreground : colors.mutedForeground }]}>
          I have read and agree to the Flight Policy.
        </Text>
      </Pressable>
      {!acknowledgedOnServer && (
        <SecondaryButton
          label="Acknowledge flight policy"
          testID="flight-policy-acknowledge"
          disabled={!canAcknowledgeProductionPolicy()}
          loading={winnerActions.policySubmitting}
          onPress={() => {
            if (legId === null || !canAcknowledgeProductionPolicy()) return;
            const decision = reviewPolicyAcknowledgement(legId);
            if (decision.status !== 'ready') return;
            const block = policyActionBlock({
              isWinner: reviewedTrip !== null,
              checklistAvailable: reviewedTrip !== null,
              policyAvailable: true,
              scrollComplete,
              consentChecked: read.checked,
              policyAckAt: reviewedTrip?.checklist.policyAckAt ?? null,
            });
            void winnerActions.acknowledgePolicy(block, read.checked, scopeRef);
          }}
        />
      )}
      {!canAcknowledgeProductionPolicy() && !acknowledgedOnServer && (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Policy acknowledgement is not available in this build. No request is sent.
        </Text>
      )}
      {policyResultVisible && winnerActions.policyFailure && (
        <Text testID="flight-policy-error" style={[styles.note, { color: colors.destructive }]}>
          {winnerActions.policyFailure.title}. {winnerActions.policyFailure.body}
        </Text>
      )}
      {(acknowledgedOnServer || (policyResultVisible && winnerActions.policyMessage)) && (
        <Text testID="flight-policy-acknowledged" style={[styles.note, { color: colors.foreground }]}>
          {winnerActions.policyMessage && policyResultVisible
            ? winnerActions.policyMessage
            : 'Policy acknowledged.'}
        </Text>
      )}
      {(acknowledgedOnServer || (policyResultVisible && winnerActions.policyMessage)) && (
        <SecondaryButton
          label="Back to checklist"
          testID="flight-policy-back"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else if (legId !== null) {
              router.replace({ pathname: '/flight/checklist', params: { legId: String(legId) } });
            }
          }}
        />
      )}
    </View>
  );
}

function matchingTrip(trip: ProductionTrip | undefined, legId: number): ProductionTrip | null {
  if (!trip || !tripMatchesFlight(trip, legId)) return null;
  return trip;
}

function hasRecordedTime(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function failureKind(error: unknown): 'missing' | 'invalid' | 'network' {
  if (error instanceof ProductionReadHttpError && error.status === 404) return 'missing';
  if (
    error instanceof ProductionReadSchemaError ||
    error instanceof ProductionReadInvalidJsonError ||
    error instanceof TypeError
  ) return 'invalid';
  return 'network';
}

function Message({
  title,
  body,
  colors,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  colors: ReturnType<typeof useColors>;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View testID="flight-policy-message" style={[styles.centered, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground, textAlign: 'center' }]}>{title}</Text>
      <Text style={[styles.note, { color: colors.mutedForeground, textAlign: 'center' }]}>{body}</Text>
      {actionLabel && onAction ? (
        <SecondaryButton label={actionLabel} testID="flight-policy-retry" onPress={onAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.4 },
  version: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 20 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 6 },
  agreeLabel: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
