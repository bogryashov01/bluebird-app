import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { useColors } from '@/hooks/useColors';
import {
  attemptAccountDeletionPhoneReverification,
  prepareAccountDeletionPhoneReverification,
  type AccountDeletionReverificationSession,
  type AccountDeletionSessionVerificationLevel,
} from '@/lib/accountDeletionPhoneReverification';

export type AccountDeletionPhoneReverificationChallenge = {
  level: AccountDeletionSessionVerificationLevel | undefined;
  complete: () => void;
  cancel: () => void;
};

type Props = {
  visible: boolean;
  session: AccountDeletionReverificationSession | null | undefined;
  challenge: AccountDeletionPhoneReverificationChallenge | null;
  onDismissed: () => void;
};

/**
 * Minimal phone OTP sheet for Clerk session reverification during account
 * deletion. Reuses the same ThemedTextInput OTP patterns as ClerkAuthPanel.
 */
export function AccountDeletionPhoneReverificationModal({
  visible,
  session,
  challenge,
  onDismissed,
}: Props) {
  const colors = useColors();
  const [code, setCode] = useState('');
  const [safeIdentifier, setSafeIdentifier] = useState<string | null>(null);
  const [stage, setStage] = useState<'first_factor' | 'second_factor'>('first_factor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preparingRef = useRef(false);

  useEffect(() => {
    if (!visible || !challenge) return;
    let cancelled = false;
    preparingRef.current = true;
    setCode('');
    setError(null);
    setSafeIdentifier(null);
    setBusy(true);

    void (async () => {
      const prepared = await prepareAccountDeletionPhoneReverification({
        session,
        level: challenge.level,
      });
      if (cancelled) return;
      preparingRef.current = false;
      setBusy(false);
      if (prepared.kind === 'complete') {
        onDismissed();
        challenge.complete();
        return;
      }
      if (prepared.kind === 'unavailable') {
        setError(
          prepared.reason === 'no_phone_factor'
            ? 'Phone verification is not available for this session. Your account was not deleted.'
            : 'Bluebird could not start phone verification. Your account was not deleted.',
        );
        return;
      }
      setStage(prepared.stage);
      setSafeIdentifier(prepared.safeIdentifier);
    })();

    return () => {
      cancelled = true;
      preparingRef.current = false;
    };
  }, [visible, challenge, session, onDismissed]);

  const closeCancelled = () => {
    if (busy && preparingRef.current) return;
    challenge?.cancel();
    onDismissed();
  };

  const submitCode = async () => {
    if (!challenge || busy) return;
    const digits = code.replace(/\D/g, '').slice(0, 8);
    if (digits.length < 4) {
      setError('Enter the SMS verification code Clerk sent to your phone.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await attemptAccountDeletionPhoneReverification({
      session,
      stage,
      code: digits,
    });
    setBusy(false);
    if (result.kind === 'complete') {
      onDismissed();
      challenge.complete();
      return;
    }
    if (result.kind === 'needs_second_factor') {
      setStage(result.prepared.stage);
      setSafeIdentifier(result.prepared.safeIdentifier);
      setCode('');
      setError(null);
      return;
    }
    if (result.kind === 'invalid_code') {
      setError('That code did not work. Try again with the latest SMS code.');
      return;
    }
    setError('Bluebird could not verify this phone code. Your account was not deleted.');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closeCancelled}
    >
      <Pressable style={styles.backdrop} onPress={closeCancelled} testID="delete-account-reverify-backdrop">
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surface }]}
          onPress={(event) => event.stopPropagation()}
          testID="delete-account-reverify-modal"
        >
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Confirm it is you</Text>
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
            Account deletion requires a fresh phone verification. Enter the SMS code Clerk sends
            {safeIdentifier ? ` to ${safeIdentifier}` : ' to your phone'}.
          </Text>

          <Text style={[styles.label, { color: colors.mutedForegroundLight }]}>SMS verification code</Text>
          <ThemedTextInput
            testID="delete-account-reverify-code"
            accessibilityLabel="SMS verification code"
            autoComplete="one-time-code"
            autoCapitalize="none"
            editable={!busy}
            keyboardType="number-pad"
            maxLength={8}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, '').slice(0, 8));
              setError(null);
            }}
            onSubmitEditing={() => { void submitCode(); }}
            placeholder="Enter code"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="go"
            style={[
              styles.input,
              {
                backgroundColor: colors.offWhite,
                borderColor: error ? colors.destructive : colors.border,
                color: colors.textOnSurface,
              },
            ]}
            textContentType="oneTimeCode"
            value={code}
          />

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]} testID="delete-account-reverify-error">
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            testID="delete-account-reverify-submit"
            accessibilityRole="button"
            disabled={busy}
            onPress={() => { void submitCode(); }}
            style={[
              styles.primary,
              { backgroundColor: colors.primary, opacity: busy ? 0.55 : 1 },
            ]}
            activeOpacity={0.8}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>Verify and continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            testID="delete-account-reverify-cancel"
            accessibilityRole="button"
            disabled={busy && preparingRef.current}
            onPress={closeCancelled}
            style={styles.cancel}
            activeOpacity={0.75}
          >
            <Text style={[styles.cancelText, { color: colors.primary }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 34,
    gap: 12,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.4 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 14,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    letterSpacing: 1,
  },
  error: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  primary: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
