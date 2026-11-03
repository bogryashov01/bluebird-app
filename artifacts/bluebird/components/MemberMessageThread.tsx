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
  limitMemberMessageBody,
  memberMessageBodyIssue,
  MEMBER_MESSAGE_MAX_LENGTH,
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
            Private messages stay off until that service is ready.
          </Text>
        </View>
      ) : thread.status === 'signed-out' ? (
        <Text style={[styles.stateBody, { color: colors.textOnSurface }]} testID="member-message-signed-out">Sign in to view messages</Text>
      ) : thread.status === 'loading' && thread.messages.length === 0 ? (
        <View style={styles.state} testID="member-message-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={{ backgroundColor: colors.offWhite }} contentContainerStyle={styles.messages}>
          {thread.hasMore ? (
            <TouchableOpacity accessibilityRole="button" testID="member-message-earlier" onPress={() => { void thread.loadEarlier(); }} style={styles.earlier}>
              <Text style={[styles.earlierLabel, { color: colors.primary }]}>Load earlier messages</Text>
            </TouchableOpacity>
          ) : null}
          {thread.status === 'ready' && thread.messages.length === 0 ? (
            <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]} testID="member-message-empty">No messages yet.</Text>
          ) : null}
          {thread.messages.map((message) => {
            const mine = message.senderUserId === thread.viewerId;
            return (
              <View key={message.id} style={[styles.bubbleWrap, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
                <View testID={`member-message-${message.id}`} style={[styles.bubble, { backgroundColor: mine ? colors.primary : colors.surface }]}>
                  <Text style={[styles.body, { color: mine ? colors.primaryForeground : colors.textOnSurface }]}>{message.body}</Text>
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
        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
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
            style={[styles.send, { backgroundColor: colors.primary, opacity: canSend ? 1 : 0.45 }]}
          >
            <Text style={[styles.sendLabel, { color: colors.primaryForeground }]}>{thread.pending ? 'Sending' : 'Send'}</Text>
          </TouchableOpacity>
          <Text style={[styles.counter, { color: colors.mutedForegroundLight }]} testID="member-message-count">
            {Array.from(draft).length}/{MEMBER_MESSAGE_MAX_LENGTH}
          </Text>
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
  messages: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  bubbleWrap: { maxWidth: '86%' },
  bubble: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22 },
  earlier: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  earlierLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  composer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Inter_400Regular', fontSize: 16 },
  send: { minHeight: 44, minWidth: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  sendLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  counter: { width: '100%', fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right' },
  feedback: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, paddingHorizontal: 16 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
