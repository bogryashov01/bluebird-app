import React, { useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider } from '@/lib/clerkProductionTokenProvider';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  createAccountDeletionClient,
  isAccountDeletionConfirmationValid,
  isAccountDeletionMutationEnabled,
  presentAccountDeletionFailure,
  type AccountDeletionFailureCode,
} from '@/lib/accountDeletion';
import { ProductionAuthenticatedUnavailableNotice } from '@/components/ProductionAuthenticatedUnavailableNotice';

type ScreenPhase =
  | { kind: 'form' }
  | { kind: 'submitting' }
  | { kind: 'pending'; message: string }
  | { kind: 'deleted' }
  | {
      kind: 'error';
      code: AccountDeletionFailureCode;
      conflictCode: string | null;
    };

export default function DeleteAccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authMode, demoMode, signOut, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const mutationEnabled = isAccountDeletionMutationEnabled();
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [phase, setPhase] = useState<ScreenPhase>({ kind: 'form' });
  const submitting = phase.kind === 'submitting';
  const confirmationValid = isAccountDeletionConfirmationValid(confirmation);
  const canSubmit = acknowledged && confirmationValid && !submitting && phase.kind !== 'deleted';

  const client = useMemo(() => {
    if (!configuration) return null;
    return createAccountDeletionClient({
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      enabled: mutationEnabled,
      getAccessToken: async () => {
        const provider = createClerkProductionTokenProvider({
          getCurrentSession: () => {
            const current = sessionRef.current;
            if (!current?.isSignedIn || !current.userId) {
              return {
                isLoaded: true,
                isSignedIn: false,
                getToken: async () => null,
                signOut: async () => {},
              };
            }
            return current;
          },
        }, configuration.environment);
        return provider.getVerifiedAccessToken();
      },
    });
  }, [configuration, mutationEnabled]);

  if (demoMode || authMode !== 'clerk') {
    return (
      <ProductionAuthenticatedUnavailableNotice
        title="Account deletion unavailable"
        description="Account deletion is available for signed-in Bluebird members using Clerk."
        testID="delete-account-unavailable"
      />
    );
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const goToProfile = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  };

  const submitDeletion = async () => {
    if (!canSubmit || submitting) return;
    if (!client) {
      setPhase({ kind: 'error', code: 'configuration', conflictCode: null });
      return;
    }
    if (!mutationEnabled) {
      setPhase({ kind: 'error', code: 'disabled', conflictCode: null });
      return;
    }
    if (!clerkUserId || session?.userId !== clerkUserId) {
      setPhase({ kind: 'error', code: 'unauthorized', conflictCode: null });
      return;
    }

    setPhase({ kind: 'submitting' });
    const result = await client.deleteAccount({ confirmation });
    if (result.kind === 'disabled') {
      setPhase({ kind: 'error', code: 'disabled', conflictCode: null });
      return;
    }
    if (result.kind === 'error') {
      setPhase({
        kind: 'error',
        code: result.code,
        conflictCode: result.conflictCode,
      });
      return;
    }
    if (result.data.kind === 'pending') {
      setPhase({ kind: 'pending', message: result.data.message });
      return;
    }
    setPhase({ kind: 'deleted' });
    // Only after a confirmed deleted response — never after request send alone.
    await signOut();
  };

  const errorCopy = phase.kind === 'error'
    ? presentAccountDeletionFailure({
      code: phase.code,
      conflictCode: phase.conflictCode,
    })
    : null;

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

        {phase.kind === 'pending' ? (
          <View
            style={[styles.banner, { backgroundColor: colors.muted, borderColor: colors.border }]}
            testID="delete-account-pending"
          >
            <Text style={[styles.bannerText, { color: colors.textOnSurface }]}>
              {phase.message}
            </Text>
            <Text style={[styles.bannerText, { color: colors.mutedForegroundLight, marginTop: 8 }]}>
              You remain signed in until deletion finishes.
            </Text>
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
          </View>
        ) : null}

        {phase.kind !== 'pending' && phase.kind !== 'deleted' ? (
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

        {phase.kind === 'deleted' ? (
          <View testID="delete-account-deleted" style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.bannerText, { color: colors.mutedForegroundLight, textAlign: 'center' }]}>
              Account deleted. Signing you out…
            </Text>
          </View>
        ) : null}
      </ScrollView>
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
  centered: { alignItems: 'center', gap: 12, paddingVertical: 24 },
});
