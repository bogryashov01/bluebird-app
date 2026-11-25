import React from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  MEMBER_REPORT_REASONS,
  createMemberSafetyClient,
  isMemberSafetyEnabled,
  memberReportReasonLabel,
  presentMemberBlockConfirmation,
  presentMemberBlockSuccess,
  presentMemberReportSuccess,
  presentMemberSafetyFailure,
  publishMemberSafetyRefresh,
  type MemberReportReason,
  type MemberSafetyFailure,
} from '@/lib/memberSafety';

export function MemberSafetyDialogs({
  targetUserId,
  mode,
  messageId,
  onClose,
  onBlocked,
}: {
  targetUserId: string | null;
  mode: 'report' | 'block' | null;
  messageId?: number;
  onClose: () => void;
  onBlocked?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const [reason, setReason] = React.useState<MemberReportReason>('harassment');
  const [description, setDescription] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    setReason('harassment');
    setDescription('');
    setNotice(null);
    setDone(false);
    pendingRef.current = false;
    setPending(false);
  }, [mode, targetUserId, messageId]);

  const fail = (code: MemberSafetyFailure) => {
    setNotice(presentMemberSafetyFailure(code));
  };

  const client = () => {
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration || !isMemberSafetyEnabled()) return null;
    return createMemberSafetyClient({
      enabled: true,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      getAccessToken: () => sessionRef.current?.getToken() ?? Promise.resolve(null),
    });
  };

  const submitReport = () => {
    if (!targetUserId || pendingRef.current || done) return;
    pendingRef.current = true;
    setPending(true);
    setNotice(null);
    const safety = client();
    if (!safety) {
      pendingRef.current = false;
      setPending(false);
      fail('configuration');
      return;
    }
    void safety.report({
      targetUserId,
      reason,
      description,
      ...(messageId === undefined ? {} : { messageId }),
    }).then((result) => {
      if (result.kind === 'loaded') {
        setDone(true);
        setNotice(presentMemberReportSuccess());
        return;
      }
      fail(result.kind === 'disabled' ? 'configuration' : result.code);
    }).finally(() => {
      pendingRef.current = false;
      setPending(false);
    });
  };

  const submitBlock = () => {
    if (!targetUserId || pendingRef.current || done) return;
    pendingRef.current = true;
    setPending(true);
    setNotice(null);
    const safety = client();
    if (!safety) {
      pendingRef.current = false;
      setPending(false);
      fail('configuration');
      return;
    }
    void safety.block(targetUserId).then((result) => {
      if (result.kind === 'loaded') {
        publishMemberSafetyRefresh();
        setDone(true);
        setNotice(presentMemberBlockSuccess());
        onBlocked?.();
        return;
      }
      fail(result.kind === 'disabled' ? 'configuration' : result.code);
    }).finally(() => {
      pendingRef.current = false;
      setPending(false);
    });
  };

  return (
    <Modal visible={mode !== null} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modal}>
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={pending ? undefined : onClose} />
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.offWhite,
              borderColor: colors.border,
              paddingBottom: 20 + Math.max(insets.bottom, 16),
            },
          ]}
          testID="member-safety-dialog"
        >
          {mode === 'block' ? (
            <>
              <Text style={[styles.title, { color: colors.textOnSurface }]}>Block member</Text>
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]} testID="member-block-confirm-copy">
                {presentMemberBlockConfirmation()}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: colors.textOnSurface }]}>
                {messageId === undefined ? 'Report member' : 'Report message'}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
                Reports are private. Reporting does not block the member.
              </Text>
              <View style={styles.reasons}>
                {MEMBER_REPORT_REASONS.map((item) => {
                  const selected = item === reason;
                  return (
                    <TouchableOpacity
                      key={item}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      disabled={pending || done}
                      testID={`member-report-reason-${item}`}
                      onPress={() => setReason(item)}
                      style={[
                        styles.reason,
                        {
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.secondary : colors.surface,
                        },
                      ]}
                    >
                      <Text style={[styles.reasonLabel, { color: colors.textOnSurface }]}>
                        {memberReportReasonLabel(item)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <ThemedTextInput
                value={description}
                onChangeText={setDescription}
                editable={!pending && !done}
                multiline
                placeholder="Optional details"
                placeholderTextColor={colors.mutedForegroundLight}
                testID="member-report-description"
                style={[styles.input, { color: colors.textOnSurface, backgroundColor: colors.surface, borderColor: colors.border }]}
              />
            </>
          )}
          {notice ? (
            <Text style={[styles.body, { color: colors.textOnSurface }]} testID="member-safety-notice">{notice}</Text>
          ) : null}
          <View style={styles.actions}>
            {done ? (
              <TouchableOpacity accessibilityRole="button" testID="member-safety-done" onPress={onClose} style={[styles.filled, { backgroundColor: colors.primary }]}>
                <Text style={[styles.filledLabel, { color: colors.primaryForeground }]}>Done</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={pending}
                  testID="member-safety-cancel"
                  onPress={onClose}
                  style={[styles.outline, { borderColor: colors.primary, opacity: pending ? 0.55 : 1 }]}
                >
                  <Text style={[styles.outlineLabel, { color: colors.primary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={pending || !targetUserId}
                  testID={mode === 'block' ? 'member-block-confirm' : 'member-report-submit'}
                  onPress={mode === 'block' ? submitBlock : submitReport}
                  style={[styles.filled, { backgroundColor: mode === 'block' ? colors.destructive : colors.primary, opacity: pending ? 0.55 : 1 }]}
                >
                  {pending ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.filledLabel, { color: mode === 'block' ? colors.destructiveForeground : colors.primaryForeground }]}>
                      {mode === 'block' ? 'Block member' : 'Submit report'}
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,17,40,0.45)' },
  card: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20, gap: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  reasonLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  input: { minHeight: 88, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Inter_400Regular', fontSize: 15 },
  actions: { flexDirection: 'row', gap: 10 },
  filled: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  filledLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  outline: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  outlineLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
