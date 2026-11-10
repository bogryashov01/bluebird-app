import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useReverification, useSession } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import {
  useClerkAuthSnapshot,
  useClerkProviderMounted,
} from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  accountDeletionResultForReverification,
  createAccountDeletionClient,
  isAccountDeletionConfirmationValid,
  isAccountDeletionEligible,
  isAccountDeletionMutationEnabled,
  isAccountDeletionReverificationHint,
  presentAccountDeletionConflict,
  presentAccountDeletionFailure,
  type AccountDeletionBlocker,
  type AccountDeletionFailureCode,
} from '@/lib/accountDeletion';
import {
  isAccountDeletionReverificationCancelledError,
  type AccountDeletionReverificationSession,
} from '@/lib/accountDeletionPhoneReverification';
import {
  AccountDeletionPhoneReverificationModal,
  type AccountDeletionPhoneReverificationChallenge,
} from '@/components/AccountDeletionPhoneReverificationModal';
import { ProductionAuthenticatedUnavailableNotice } from '@/components/ProductionAuthenticatedUnavailableNotice';

type ScreenPhase =
  | { kind: 'loading_eligibility' }
  | { kind: 'form' }
  | { kind: 'unavailable' }
  | { kind: 'blocked'; blockers: readonly AccountDeletionBlocker[] }
  | { kind: 'submitting' }
  | {
      kind: 'pending';
      requestId: string | null;
      message: string;
      retryable: boolean;
    }
  | { kind: 'completed' }
  | {
      kind: 'error';
      code: AccountDeletionFailureCode;
      conflictCode: string | null;
      retryable: boolean;
    };

export default function DeleteAccountScreen() {
  const { authMode, demoMode } = useAuth();
  const providerMounted = useClerkProviderMounted();

  if (demoMode || authMode !== 'clerk' || !providerMounted) {
    return (
      <ProductionAuthenticatedUnavailableNotice
        title="Account deletion unavailable"
        description="Account deletion is available for signed-in Bluebird members using Clerk."
        testID="delete-account-unavailable"
      />
    );
  }

  return <DeleteAccountClerkScreen />;
}

function DeleteAccountClerkScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut, clerkUserId } = useAuth();
  const authSnapshot = useClerkAuthSnapshot();
  const authSnapshotRef = useRef(authSnapshot);
  authSnapshotRef.current = authSnapshot;
  const { session: clerkSession } = useSession();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const mutationEnabled = isAccountDeletionMutationEnabled();
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [membershipCancellationAcknowledged, setMembershipCancellationAcknowledged] = useState(false);
  const [requiresMembershipAck, setRequiresMembershipAck] = useState(false);
  const [phase, setPhase] = useState<ScreenPhase>(
    mutationEnabled ? { kind: 'loading_eligibility' } : { kind: 'form' },
  );
  const [reverifyChallenge, setReverifyChallenge] =
    useState<AccountDeletionPhoneReverificationChallenge | null>(null);
  const submitting = phase.kind === 'submitting';
  const confirmationValid = isAccountDeletionConfirmationValid(confirmation);
  const membershipAckSatisfied = !requiresMembershipAck || membershipCancellationAcknowledged;
  const canSubmit = acknowledged
    && confirmationValid
    && membershipAckSatisfied
    && !submitting
    && phase.kind !== 'completed'
    && phase.kind !== 'pending'
    && phase.kind !== 'blocked'
    && phase.kind !== 'unavailable'
    && phase.kind !== 'loading_eligibility';

  const client = useMemo(() => {
    if (!configuration) return null;
    return createAccountDeletionClient({
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      enabled: mutationEnabled,
      getAccessToken: async () => {
        const current = authSnapshotRef.current;
        if (!current?.isLoaded || current.isSignedIn !== true) return null;
        // After session reverification, skipCache forces a fresh JWT. Never treat
        // a stale cached token as sufficient for this sensitive mutation.
        const getToken = current.getToken as (options?: { skipCache?: boolean }) => Promise<string | null>;
        const token = await getToken({ skipCache: true });
        return typeof token === 'string' && token.trim() ? token : null;
      },
    });
  }, [configuration, mutationEnabled]);

  const clientRef = useRef(client);
  clientRef.current = client;
  const confirmationRef = useRef(confirmation);
  confirmationRef.current = confirmation;
  const membershipAckRef = useRef(false);
  membershipAckRef.current = requiresMembershipAck ? membershipCancellationAcknowledged : false;

  const deleteWithReverification = useReverification(
    async () => {
      const activeClient = clientRef.current;
      if (!activeClient) {
        return {
          kind: 'error' as const,
          code: 'configuration' as const,
          conflictCode: null,
          retryable: false,
        };
      }
      const result = await activeClient.deleteAccount({
        confirmation: confirmationRef.current,
        acknowledgeMembershipCancellation: membershipAckRef.current,
      });
      return accountDeletionResultForReverification(result);
    },
    {
      onNeedsReverification: ({ level, complete, cancel }) => {
        setReverifyChallenge({ level, complete, cancel });
      },
    },
  );

  const applyCompleted = useCallback(async () => {
    setPhase({ kind: 'completed' });
    await signOut();
  }, [signOut]);

  const loadEligibility = useCallback(async () => {
    if (!mutationEnabled || !client) {
      setRequiresMembershipAck(false);
      setPhase({ kind: 'form' });
      return;
    }
    setPhase({ kind: 'loading_eligibility' });

    const [eligibility, status] = await Promise.all([
      client.getEligibility(),
      client.getStatus(),
    ]);

    if (status.kind === 'loaded' && status.data.kind === 'completed') {
      await applyCompleted();
      return;
    }
    if (status.kind === 'loaded' && status.data.kind === 'pending') {
      setPhase({
        kind: 'pending',
        requestId: status.data.requestId,
        message: status.data.message,
        retryable: status.data.retryable,
      });
      return;
    }
    if (status.kind === 'error' && status.code !== 'unauthorized') {
      // Status errors other than a quiet not-requested path still matter when
      // eligibility cannot be loaded; fall through to eligibility first.
    }

    if (eligibility.kind === 'disabled') {
      setRequiresMembershipAck(false);
      setPhase({ kind: 'form' });
      return;
    }
    if (eligibility.kind === 'error') {
      setPhase({
        kind: 'error',
        code: eligibility.code,
        conflictCode: null,
        retryable: eligibility.retryable,
      });
      return;
    }

    setRequiresMembershipAck(eligibility.data.requiresMembershipCancellationAcknowledgement);
    if (!eligibility.data.requiresMembershipCancellationAcknowledgement) {
      setMembershipCancellationAcknowledged(false);
    }

    if (eligibility.data.blockers.length > 0) {
      setPhase({ kind: 'blocked', blockers: eligibility.data.blockers });
      return;
    }
    if (!eligibility.data.enabled || !isAccountDeletionEligible(eligibility.data)) {
      setPhase({ kind: 'unavailable' });
      return;
    }
    setPhase({ kind: 'form' });
  }, [applyCompleted, client, mutationEnabled]);

  useEffect(() => {
    void loadEligibility();
  }, [loadEligibility]);

  const refreshPendingStatus = async () => {
    if (!client || !mutationEnabled) return;
    setPhase({ kind: 'submitting' });
    const status = await client.getStatus();
    if (status.kind === 'disabled') {
      setPhase({ kind: 'error', code: 'disabled', conflictCode: null, retryable: false });
      return;
    }
    if (status.kind === 'error') {
      setPhase({
        kind: 'error',
        code: status.code,
        conflictCode: null,
        retryable: status.retryable,
      });
      return;
    }
    if (status.data.kind === 'completed') {
      await applyCompleted();
      return;
    }
    if (status.data.kind === 'pending') {
      setPhase({
        kind: 'pending',
        requestId: status.data.requestId,
        message: status.data.message,
        retryable: status.data.retryable,
      });
      return;
    }
    setPhase({ kind: 'form' });
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const goToProfile = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  };

  const submitDeletion = async () => {
    if (!canSubmit || submitting) return;
    if (!client) {
      setPhase({ kind: 'error', code: 'configuration', conflictCode: null, retryable: false });
      return;
    }
    if (!mutationEnabled) {
      setPhase({ kind: 'error', code: 'disabled', conflictCode: null, retryable: false });
      return;
    }
    if (!clerkUserId || authSnapshot?.userId !== clerkUserId) {
      setPhase({ kind: 'error', code: 'unauthorized', conflictCode: null, retryable: false });
      return;
    }
    if (requiresMembershipAck && !membershipCancellationAcknowledged) {
      setPhase({
        kind: 'error',
        code: 'membership_ack_required',
        conflictCode: 'membership_cancellation_confirmation_required',
        retryable: true,
      });
      return;
    }

    setPhase({ kind: 'submitting' });
    try {
      const result = await deleteWithReverification();
      setReverifyChallenge(null);

      if (isAccountDeletionReverificationHint(result)) {
        setPhase({
          kind: 'error',
          code: 'reverification_unavailable',
          conflictCode: null,
          retryable: true,
        });
        return;
      }
      if (result.kind === 'disabled') {
        setPhase({ kind: 'error', code: 'disabled', conflictCode: null, retryable: false });
        return;
      }
      if (result.kind === 'error') {
        if (result.code === 'membership_ack_required') {
          setRequiresMembershipAck(true);
        }
        setPhase({
          kind: 'error',
          code: result.code,
          conflictCode: result.conflictCode,
          retryable: result.retryable,
        });
        return;
      }
      if (result.data.kind === 'pending') {
        setPhase({
          kind: 'pending',
          requestId: result.data.requestId,
          message: result.data.message,
          retryable: result.data.retryable,
        });
        return;
      }
      // Only after a confirmed completed response — never after request send alone.
      await applyCompleted();
    } catch (error) {
      setReverifyChallenge(null);
      if (isAccountDeletionReverificationCancelledError(error)) {
        setPhase({
          kind: 'error',
          code: 'reverification_cancelled',
          conflictCode: null,
          retryable: true,
        });
        return;
      }
      setPhase({ kind: 'error', code: 'server', conflictCode: null, retryable: true });
    }
  };

  const errorCopy = phase.kind === 'error'
    ? presentAccountDeletionFailure({
      code: phase.code,
      conflictCode: phase.conflictCode,
      retryable: phase.retryable,
    })
    : null;

  const blockedCopy = phase.kind === 'blocked'
    ? phase.blockers.length > 0
      ? phase.blockers.map((blocker) => presentAccountDeletionConflict(blocker.code)).join('\n\n')
      : presentAccountDeletionConflict('account_deletion_blocked')
    : null;

  const showForm = phase.kind === 'form'
    || phase.kind === 'submitting'
    || (phase.kind === 'error' && errorCopy?.canRetry === true);

  return (
    <View
      style={[styles.root, { backgroundColor: colors.offWhite, paddingTop: topPad + 12 }]}
      testID="delete-account-screen"
    >
      <TouchableOpacity
        onPress={goToProfile}
        style={[styles.backButton, { backgroundColor: colors.surface }]}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Back to Profile"
        testID="delete-account-back"
        disabled={submitting}
      >
        <Feather name="chevron-left" size={23} color={colors.textOnSurface} />
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Delete Account</Text>
        <Text style={[styles.lead, { color: colors.mutedForegroundLight }]}>
          Permanently delete your Bluebird member account. This cannot be undone.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>What deletion removes</Text>
          {[
            'Your Bluebird profile and personal details',
            'Flight queue participation linked to this account',
            'Connections, connection requests, and messages',
            'App access for this signed-in member',
          ].map((item) => (
            <Text key={item} style={[styles.bullet, { color: colors.mutedForegroundLight }]}>
              • {item}
            </Text>
          ))}
          <Text style={[styles.note, { color: colors.mutedForegroundLight }]}>
            Membership billing is managed on the Bluebird website. If you have an active membership or payment method, contact Bluebird support after deletion if a charge continues.
          </Text>
          <Text style={[styles.note, { color: colors.mutedForegroundLight }]}>
            Active trips or open flight offers may temporarily block deletion until they are resolved.
          </Text>
          <Text style={[styles.note, { color: colors.mutedForegroundLight }]}>
            Deletion requires a fresh phone SMS verification through Clerk. Ordinary sign-in is not enough by itself.
          </Text>
        </View>

        {!mutationEnabled ? (
          <View
            style={[styles.banner, { backgroundColor: colors.muted, borderColor: colors.border }]}
            testID="delete-account-mutation-disabled"
          >
            <Text style={[styles.bannerText, { color: colors.mutedForegroundLight }]}>
              Account deletion requests are not enabled in this build yet. You can review this screen, but Bluebird will not send a deletion request or change your account.
            </Text>
          </View>
        ) : null}

        {phase.kind === 'loading_eligibility' ? (
          <View style={styles.centered} testID="delete-account-eligibility-loading">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {phase.kind === 'unavailable' ? (
          <View
            style={[styles.banner, { backgroundColor: colors.muted, borderColor: colors.border }]}
            testID="delete-account-backend-disabled"
          >
            <Text style={[styles.bannerText, { color: colors.mutedForegroundLight }]}>
              Account deletion is not available for this account right now. Your account was not deleted.
            </Text>
          </View>
        ) : null}

        {phase.kind === 'blocked' ? (
          <View
            style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.destructive }]}
            testID="delete-account-blocked"
            accessibilityRole="alert"
          >
            <Text style={[styles.bannerTitle, { color: colors.destructive }]}>Deletion blocked</Text>
            <Text style={[styles.bannerText, { color: colors.mutedForegroundLight }]}>{blockedCopy}</Text>
          </View>
        ) : null}

        {phase.kind === 'pending' ? (
          <View
            style={[styles.banner, { backgroundColor: colors.muted, borderColor: colors.border }]}
            testID="delete-account-pending"
          >
            <Text style={[styles.bannerText, { color: colors.textOnSurface }]}>
              {phase.message}
            </Text>
            {phase.requestId ? (
              <Text style={[styles.bannerText, { color: colors.mutedForegroundLight, marginTop: 8 }]}>
                Request ID: {phase.requestId}
              </Text>
            ) : null}
            <Text style={[styles.bannerText, { color: colors.mutedForegroundLight, marginTop: 8 }]}>
              You remain signed in until deletion finishes. Bluebird has not deleted your account yet.
            </Text>
            {mutationEnabled ? (
              <TouchableOpacity
                testID="delete-account-status-refresh"
                accessibilityRole="button"
                onPress={() => { void refreshPendingStatus(); }}
                style={styles.refreshButton}
                activeOpacity={0.75}
              >
                <Text style={[styles.cancelText, { color: colors.primary }]}>Check deletion status</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {errorCopy ? (
          <View
            style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.destructive }]}
            testID="delete-account-error"
            accessibilityRole="alert"
          >
            <Text style={[styles.bannerTitle, { color: colors.destructive }]}>{errorCopy.title}</Text>
            <Text style={[styles.bannerText, { color: colors.mutedForegroundLight }]}>{errorCopy.body}</Text>
            {errorCopy.canRetry ? (
              <TouchableOpacity
                testID="delete-account-retry"
                accessibilityRole="button"
                onPress={() => setPhase({ kind: 'form' })}
                style={styles.refreshButton}
                activeOpacity={0.75}
              >
                <Text style={[styles.cancelText, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {showForm ? (
          <>
            <TouchableOpacity
              testID="delete-account-acknowledge"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged, disabled: submitting }}
              disabled={submitting}
              onPress={() => setAcknowledged((value) => !value)}
              style={styles.checkRow}
              activeOpacity={0.75}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: colors.border,
                    backgroundColor: acknowledged ? colors.primary : colors.surface,
                  },
                ]}
              >
                {acknowledged ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
              </View>
              <Text style={[styles.checkLabel, { color: colors.textOnSurface }]}>
                I understand that deleting my account is permanent.
              </Text>
            </TouchableOpacity>

            {requiresMembershipAck ? (
              <TouchableOpacity
                testID="delete-account-membership-ack"
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: membershipCancellationAcknowledged,
                  disabled: submitting,
                }}
                disabled={submitting}
                onPress={() => setMembershipCancellationAcknowledged((value) => !value)}
                style={styles.checkRow}
                activeOpacity={0.75}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: colors.border,
                      backgroundColor: membershipCancellationAcknowledged
                        ? colors.primary
                        : colors.surface,
                    },
                  ]}
                >
                  {membershipCancellationAcknowledged
                    ? <Feather name="check" size={14} color={colors.primaryForeground} />
                    : null}
                </View>
                <Text style={[styles.checkLabel, { color: colors.textOnSurface }]}>
                  I acknowledge that deleting my account also cancels my Bluebird membership.
                </Text>
              </TouchableOpacity>
            ) : null}

            <Text style={[styles.inputLabel, { color: colors.mutedForegroundLight }]}>
              Type {ACCOUNT_DELETION_CONFIRMATION_WORD} to confirm
            </Text>
            <ThemedTextInput
              testID="delete-account-confirmation-input"
              value={confirmation}
              onChangeText={setConfirmation}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!submitting}
              placeholder={ACCOUNT_DELETION_CONFIRMATION_WORD}
              style={[
                styles.input,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.textOnSurface,
                },
              ]}
            />

            <TouchableOpacity
              testID="delete-account-submit"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
              disabled={!canSubmit}
              onPress={() => { void submitDeletion(); }}
              style={[
                styles.deleteButton,
                {
                  backgroundColor: colors.destructive,
                  opacity: canSubmit ? 1 : 0.45,
                },
              ]}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.deleteButtonText, { color: colors.destructiveForeground }]}>
                  {mutationEnabled ? 'Delete my account' : 'Deletion unavailable'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              testID="delete-account-cancel"
              accessibilityRole="button"
              disabled={submitting}
              onPress={goToProfile}
              style={styles.cancelButton}
              activeOpacity={0.75}
            >
              <Text style={[styles.cancelText, { color: colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {phase.kind === 'completed' ? (
          <View testID="delete-account-deleted" style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.bannerText, { color: colors.mutedForegroundLight, textAlign: 'center' }]}>
              Account deleted. Signing you out…
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <AccountDeletionPhoneReverificationModal
        visible={reverifyChallenge !== null}
        session={clerkSession as AccountDeletionReverificationSession | null | undefined}
        challenge={reverifyChallenge}
        onDismissed={() => setReverifyChallenge(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 22 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  content: { gap: 14 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.6 },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 4 },
  bullet: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 4 },
  banner: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  bannerTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 6 },
  bannerText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkLabel: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  inputLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 14,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    letterSpacing: 1,
  },
  deleteButton: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  deleteButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  cancelButton: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  refreshButton: { marginTop: 10 },
  centered: { alignItems: 'center', gap: 12, paddingVertical: 24 },
});
