import React, { useRef, useState } from 'react';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  type TextInput,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAiConcierge, type AiConciergeUiMessage } from '@/lib/useAiConcierge';

const TOPICS = [
  { label: 'Baggage', question: 'What is the baggage policy?' },
  { label: 'Pet Policy', question: 'What is the pet policy?' },
  { label: 'Airport Directions', question: 'How do I get directions to my departure airport?' },
  { label: 'FBOs', question: 'What are FBOs and which ones do you use?' },
  { label: 'Flight Questions', question: 'What should I know about Bluebird flights?' },
  { label: 'Membership', question: 'Tell me about membership tiers.' },
  { label: 'Queue System', question: 'How does the queue system work?' },
];

function rowKey(item: AiConciergeUiMessage): string {
  if (item.kind === 'server') return `server-${item.message.id}`;
  return `${item.kind}-${item.localId}`;
}

export function ProductionAiConciergeChat() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const concierge = useAiConcierge();
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList<AiConciergeUiMessage>>(null);
  const inputRef = useRef<TextInput>(null);
  const assistantBubbleBg = colors.scheme === 'dark' ? colors.secondary : colors.muted;

  const handleSend = (rawText: string) => {
    const text = rawText.trim();
    if (!text || concierge.sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setInput('');
    inputRef.current?.focus();
    void concierge.send(text);
  };

  return (
    <KeyboardAvoidingView
      testID="production-ai-concierge"
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'web' ? 0 : insets.top + 60}
    >
      {concierge.status === 'loading' && concierge.messages.length === 0 ? (
        <View style={styles.historyLoading} testID="production-ai-concierge-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      {concierge.status === 'error' && concierge.messages.length === 0 ? (
        <View style={styles.historyError} testID="production-ai-concierge-error">
          <Text style={[styles.statusText, { color: colors.destructive }]}>
            {concierge.message ?? 'Couldn’t load earlier messages.'}
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => { void concierge.refresh(); }}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {concierge.message && concierge.messages.length > 0 ? (
        <View style={styles.banner} testID="production-ai-concierge-banner">
          <Text style={[styles.statusText, { color: colors.textOnSurface }]}>{concierge.message}</Text>
        </View>
      ) : null}
      <FlatList
        ref={flatListRef}
        data={concierge.messages}
        keyExtractor={rowKey}
        contentContainerStyle={[styles.messageList, { paddingBottom: 16 }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListHeaderComponent={
          concierge.hasOlder ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Load earlier messages"
              testID="production-ai-concierge-load-older"
              style={styles.loadOlder}
              disabled={concierge.loadingOlder}
              onPress={() => { void concierge.loadOlder(); }}
            >
              {concierge.loadingOlder
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={[styles.retryText, { color: colors.primary }]}>Load earlier messages</Text>}
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'server') {
            const mine = item.message.role === 'user';
            const needsSupport = item.message.role === 'assistant' && item.message.status === 'needs_support';
            return (
              <View style={[styles.messageRow, mine && styles.messageRowUser]}>
                <View style={styles.messageBlock}>
                  <View style={[
                    styles.bubble,
                    mine
                      ? [styles.bubbleUser, { backgroundColor: colors.primary }]
                      : [styles.bubbleAssistant, { backgroundColor: assistantBubbleBg }],
                  ]}>
                    <Text style={[
                      styles.bubbleText,
                      {
                        color: mine ? colors.primaryForeground : colors.foreground,
                        fontFamily: 'Inter_400Regular',
                      },
                    ]}>
                      {item.message.body}
                    </Text>
                  </View>
                  {needsSupport ? (
                    <View style={styles.supportArea}>
                      <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                        I couldn’t fully answer that. Contact Bluebird support for help. No staff handoff was created automatically.
                      </Text>
                      {item.supportUrl ? (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel="Contact support"
                          testID={`production-ai-concierge-support-${item.message.id}`}
                          style={[styles.supportButton, { backgroundColor: colors.primary }]}
                          onPress={() => { void concierge.openSupport(item.supportUrl); }}
                        >
                          <Text style={[styles.supportButtonText, { color: colors.primaryForeground }]}>
                            Contact Support
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          }

          const mine = true;
          const failed = item.kind === 'failed-user';
          return (
            <View style={[styles.messageRow, mine && styles.messageRowUser]}>
              <View style={styles.messageBlock}>
                <View style={[styles.bubble, styles.bubbleUser, { backgroundColor: colors.primary, opacity: failed ? 0.85 : 1 }]}>
                  <Text style={[styles.bubbleText, { color: colors.primaryForeground, fontFamily: 'Inter_400Regular' }]}>
                    {item.body}
                  </Text>
                </View>
                {failed ? (
                  <View style={styles.supportArea}>
                    <Text style={[styles.statusText, { color: colors.destructive }]}>{item.error}</Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Retry message"
                      testID={`production-ai-concierge-retry-${item.localId}`}
                      style={[styles.supportButton, { backgroundColor: colors.primary }]}
                      disabled={concierge.sending}
                      onPress={() => { void concierge.retryFailed(item.localId); }}
                    >
                      <Text style={[styles.supportButtonText, { color: colors.primaryForeground }]}>
                        Try again
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            {concierge.sending ? (
              <View style={styles.messageRow} testID="production-ai-concierge-typing">
                <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: assistantBubbleBg }]}>
                  <Text style={[styles.typingText, { color: colors.mutedForeground }]}>...</Text>
                </View>
              </View>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsRow}
              keyboardShouldPersistTaps="handled"
            >
              {TOPICS.map((topic) => (
                <TouchableOpacity
                  key={topic.label}
                  style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
                  disabled={concierge.sending}
                  onPress={() => handleSend(topic.question)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                    {topic.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        }
      />

      <View style={[styles.inputBar, {
        backgroundColor: colors.headerBackground,
        borderTopColor: colors.separator,
        paddingBottom: bottomPad + 8,
      }]}>
        <ThemedTextInput
          ref={inputRef}
          testID="production-ai-concierge-input"
          style={[styles.inputField, {
            backgroundColor: colors.input,
            color: colors.foreground,
            fontFamily: 'Inter_400Regular',
          }]}
          placeholder="Ask the AI Concierge..."
          placeholderTextColor={colors.mutedForeground}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => handleSend(input)}
          returnKeyType="send"
          submitBehavior="submit"
          editable={!concierge.sending}
          multiline={false}
        />
        <TouchableOpacity
          testID="production-ai-concierge-send"
          style={[styles.sendBtn, {
            backgroundColor: colors.primary,
            opacity: input.trim() && !concierge.sending ? 1 : 0.5,
          }]}
          onPress={() => handleSend(input)}
          disabled={!input.trim() || concierge.sending}
          activeOpacity={0.8}
        >
          {concierge.sending
            ? <ActivityIndicator size="small" color={colors.primaryForeground} />
            : <Feather name="arrow-up" size={18} color={colors.primaryForeground} />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  historyLoading: { paddingTop: 24, alignItems: 'center' },
  historyError: {
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  banner: { paddingHorizontal: 16, paddingTop: 10 },
  loadOlder: { alignItems: 'center', paddingVertical: 8 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  statusText: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  messageList: { padding: 16, gap: 12 },
  messageRow: { flexDirection: 'row' },
  messageRowUser: { flexDirection: 'row-reverse' },
  messageBlock: { maxWidth: '82%', gap: 8 },
  bubble: { paddingHorizontal: 14, paddingVertical: 11 },
  bubbleAssistant: { borderRadius: 18, borderBottomLeftRadius: 6 },
  bubbleUser: { borderRadius: 18, borderBottomRightRadius: 6 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  typingText: { fontSize: 18, letterSpacing: 2 },
  footer: { gap: 12, marginTop: 4 },
  chipsScroll: { marginHorizontal: -16 },
  chipsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13 },
  supportArea: { gap: 6, alignItems: 'flex-start' },
  supportButton: {
    minHeight: 42,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  supportButtonText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  inputBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  inputField: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
