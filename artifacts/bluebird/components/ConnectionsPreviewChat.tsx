import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  DEMO_CONVERSATION_NOTICE,
  MESSAGE_CHARACTER_LIMIT,
  formatPreviewTimestamp,
  memberInitials,
} from '@/lib/connectionsPreview';
import { useConnectionsPreview } from '@/lib/useConnectionsPreview';

export function ConnectionsPreviewChat({ conversationId }: { conversationId: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const preview = useConnectionsPreview();
  const [draft, setDraft] = React.useState('');
  const [nowMs] = React.useState(() => Date.now());
  const conversation = preview.conversations.find((item) => item.id === conversationId) ?? null;
  const messages = preview.messages.filter((message) => message.conversationId === conversationId);
  const marked = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (preview.status !== 'ready' || marked.current === conversationId) return;
    marked.current = conversationId;
    void preview.markRead(conversationId);
  }, [conversationId, preview.status, preview]);

  const send = () => {
    void preview.sendMessage(conversationId, draft).then((error) => {
      if (!error) setDraft('');
    });
  };

  const topInset = Platform.OS === 'web' ? 16 : insets.top;
  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.offWhite }]} behavior="padding" testID="connections-chat-screen">
      <View style={[styles.header, { paddingTop: topInset + 6 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" testID="connections-preview-back" onPress={() => router.back()} style={styles.back}>
          <Feather name="chevron-left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>{memberInitials(conversation?.member.displayName ?? '')}</Text>
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.name, { color: colors.textOnSurface }]} numberOfLines={1}>
            {conversation?.member.displayName ?? 'Conversation'}
          </Text>
          <Text style={[styles.notice, { color: colors.mutedForegroundLight }]} testID="connections-preview-notice">
            {DEMO_CONVERSATION_NOTICE}
          </Text>
        </View>
      </View>
      {preview.status === 'ready' && !conversation ? (
        <Text style={[styles.meta, { color: colors.textOnSurface }]} testID="connections-chat-missing">
          That demo conversation is not on this device.
        </Text>
      ) : null}
      {preview.status === 'ready' && conversation && messages.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForegroundLight }]} testID="connections-chat-empty">
          No messages saved on this device yet.
        </Text>
      ) : null}
      <ScrollView contentContainerStyle={styles.messages}>
        {messages.map((message) => {
          const mine = message.author === 'you';
          return (
            <View key={message.id} style={[styles.bubbleWrap, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
              <View
                testID={`connections-message-${message.id}`}
                style={[styles.bubble, { backgroundColor: mine ? colors.primary : colors.surface }]}
              >
                <Text style={[styles.author, { color: mine ? colors.primaryForeground : colors.primary }]}>
                  {mine ? 'You · on this device' : 'Sample on this device'}
                </Text>
                <Text style={[styles.body, { color: mine ? colors.primaryForeground : colors.textOnSurface }]}>{message.body}</Text>
              </View>
              <Text style={[styles.time, { color: colors.mutedForegroundLight }]}>{formatPreviewTimestamp(message.createdAt, nowMs)}</Text>
            </View>
          );
        })}
      </ScrollView>
      {conversation && !conversation.canSend ? (
        <Text style={[styles.meta, { color: colors.textOnSurface }]} testID="connections-chat-closed">
          {conversation.closedReason === 'blocked'
            ? 'This demo profile is blocked on this device. New messages cannot be sent.'
            : 'This connection was removed on this device. New messages cannot be sent.'}
        </Text>
      ) : null}
      {preview.actionMessage ? (
        <Text style={[styles.meta, { color: colors.textOnSurface }]} testID="connections-chat-feedback">{preview.actionMessage}</Text>
      ) : null}
      <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          value={draft}
          onChangeText={(value) => setDraft(value.slice(0, MESSAGE_CHARACTER_LIMIT))}
          editable={!!conversation?.canSend}
          multiline
          placeholder="Message"
          placeholderTextColor={colors.mutedForegroundLight}
          testID="connections-composer"
          style={[styles.input, { color: colors.textOnSurface, backgroundColor: colors.surface }]}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityHint="Saves the message on this device"
          disabled={!conversation?.canSend || draft.trim().length === 0}
          testID="connections-send"
          onPress={send}
          style={[styles.send, { backgroundColor: colors.primary, opacity: conversation?.canSend && draft.trim() ? 1 : 0.45 }]}
        >
          <Text style={[styles.sendLabel, { color: colors.primaryForeground }]}>Send</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.counter, { color: colors.mutedForegroundLight }]}>{draft.length}/{MESSAGE_CHARACTER_LIMIT}</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  headerCopy: { flex: 1, gap: 2 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  notice: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  messages: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  bubbleWrap: { maxWidth: '86%', gap: 4 },
  bubble: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  author: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22 },
  time: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', padding: 24 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, paddingHorizontal: 16 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Inter_400Regular', fontSize: 16 },
  send: { minHeight: 44, minWidth: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  sendLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  counter: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'right', paddingHorizontal: 20, paddingBottom: 6 },
});
