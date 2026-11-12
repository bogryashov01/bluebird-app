import React from 'react';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { MemberInitialsAvatar } from '@/components/MemberProfileSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { connectionMemberLabel, readMemberConnectionsSnapshot } from '@/lib/memberConnections';
import {
  conversationTitle,
  formatMemberMessageDaySeparator,
  limitMemberMessageBody,
  memberMessageBodyIssue,
  memberMessageComposerLengthWarning,
  memberMessageDayKey,
} from '@/lib/memberMessages';
import { useMemberMessageThread } from '@/lib/useMemberMessages';

export function MemberMessageThread({ conversationId }: { conversationId: number | null }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const thread = useMemberMessageThread(conversationId);
  const session = useClerkAuthSnapshot();
  const [draft, setDraft] = React.useState('');
  const names = React.useMemo(() => {
    const map = new Map<string, string>();
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const accountId = session?.isSignedIn === true ? session.userId : null;
    if (!configuration || !accountId) return map;
    const snapshot = readMemberConnectionsSnapshot({
      environment: configuration.environment,
      apiBaseUrl: configuration.apiBaseUrl,
      clerkUserId: accountId,
    });
    for (const connection of snapshot?.accepted ?? []) {
      map.set(connection.member.userId, connectionMemberLabel(connection.member));
    }
    return map;
  }, [session?.isSignedIn, session?.userId, thread.participantUserId]);
  const title = thread.participantUserId
    ? conversationTitle(thread.participantUserId, names)
    : 'Bluebird member';
  const issue = memberMessageBodyIssue(draft);
  const canSend = thread.enabled && thread.status === 'ready' && !thread.pending && issue === null;
  const topInset = Platform.OS === 'web' ? 16 : insets.top;
  const lengthWarning = memberMessageComposerLengthWarning(draft);
  const composerBottom = Math.max(insets.bottom, Platform.OS === 'web' ? 12 : 6);

  const send = () => {
    if (!canSend) return;
    const body = draft;
    void thread.send(body).then((sent) => {
      if (sent) setDraft((current) => (current === body ? '' : current));
    });
  };

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.offWhite }]} behavior="padding" testID="member-message-thread">
      <View style={[styles.header, { paddingTop: topInset + 6 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" testID="member-message-back" onPress={() => router.back()} style={styles.back}>
          <Feather name="chevron-left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <MemberInitialsAvatar name={title} size={36} />
        <View style={styles.headerCopy}>
          <Text style={[styles.name, { color: colors.textOnSurface }]} numberOfLines={1}>{title}</Text>
        </View>
      </View>
      {!thread.enabled || thread.status === 'disabled' ? (
        <View style={styles.state} testID="member-message-unavailable">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Messages are not available yet</Text>
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
            Try again later.
          </Text>
        </View>
      ) : thread.status === 'signed-out' ? (
        <Text style={[styles.stateBody, { color: colors.textOnSurface }]} testID="member-message-signed-out">Sign in to view messages</Text>
      ) : thread.status === 'loading' && thread.messages.length === 0 ? (
        <View style={styles.state} testID="member-message-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={{ backgroundColor: colors.offWhite, flex: 1 }}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
        >
          {thread.hasMore ? (
            <TouchableOpacity accessibilityRole="button" testID="member-message-earlier" onPress={() => { void thread.loadEarlier(); }} style={styles.earlier}>
              <Text style={[styles.earlierLabel, { color: colors.primary }]}>Load earlier messages</Text>
            </TouchableOpacity>
          ) : null}
          {thread.status === 'ready' && thread.messages.length === 0 ? (
            <Text style={[styles.stateTitle, { color: colors.textOnSurface }]} testID="member-message-empty">No Messages Yet</Text>
          ) : null}
          {thread.messages.map((message, index) => {
            const mine = message.senderUserId === thread.viewerId;
            const previous = index > 0 ? thread.messages[index - 1] : null;
            const dayKey = memberMessageDayKey(message.createdAt);
            const previousDayKey = previous ? memberMessageDayKey(previous.createdAt) : null;
            const showDay = dayKey !== null && dayKey !== previousDayKey;
            const sameSender = previous?.senderUserId === message.senderUserId && !showDay;
            const dayLabel = showDay ? formatMemberMessageDaySeparator(message.createdAt) : null;
            return (
              <View key={message.id} style={[styles.messageBlock, { marginTop: sameSender ? 4 : 12 }]}>
                {dayLabel ? (
                  <Text
                    style={[styles.daySeparator, { color: colors.mutedForegroundLight }]}
                    testID={`member-message-day-${dayKey}`}
                  >
                    {dayLabel}
                  </Text>
                ) : null}
                <View style={[styles.bubbleWrap, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
                  <View
                    testID={`member-message-${message.id}`}
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: mine ? colors.primary : colors.surface,
                        borderBottomRightRadius: mine ? 6 : 18,
                        borderBottomLeftRadius: mine ? 18 : 6,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.body,
                        { color: mine ? colors.primaryForeground : colors.textOnSurface },
                      ]}
                      selectable
                    >
                      {message.body}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
      {thread.message ? (
        <Text style={[styles.feedback, { color: colors.textOnSurface }]} testID="member-message-feedback">{thread.message}</Text>
      ) : null}
      {thread.enabled && thread.status !== 'disabled' && thread.status !== 'signed-out' ? (
        <View style={[styles.composer, { paddingBottom: composerBottom }]} testID="member-message-composer-bar">
          <View style={styles.composerRow}>
            <ThemedTextInput
              value={draft}
              onChangeText={(value) => setDraft(limitMemberMessageBody(value))}
              editable={!thread.pending}
              multiline
              placeholder="Message"
              placeholderTextColor={colors.mutedForegroundLight}
              testID="member-message-composer"
              style={[styles.input, { color: colors.textOnSurface, backgroundColor: colors.surface }]}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={!canSend}
              testID="member-message-send"
              onPress={send}
              style={[
                styles.send,
                {
                  backgroundColor: colors.primary,
                  opacity: canSend ? 1 : 0.45,
                },
              ]}
            >
              {thread.pending ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Feather name="arrow-up" size={20} color={colors.primaryForeground} />
              )}
            </TouchableOpacity>
          </View>
          {lengthWarning ? (
            <Text style={[styles.counter, { color: colors.mutedForegroundLight }]} testID="member-message-count">
              {lengthWarning}
            </Text>
          ) : null}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  messages: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, flexGrow: 1 },
  messageBlock: { width: '100%' },
  daySeparator: {
    alignSelf: 'center',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
    marginTop: 4,
  },
  bubbleWrap: { maxWidth: '80%' },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 22,
    flexShrink: 1,
  },
  earlier: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  earlierLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 20,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    marginTop: 4,
    marginRight: 48,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    textAlign: 'right',
  },
  feedback: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 4 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8, flex: 1 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
