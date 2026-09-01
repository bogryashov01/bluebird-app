import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, ScrollView,
  TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useConciergeChat, useGetConciergeHistory, useRequestConciergeCallback } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  isError?: boolean;
  requiresHumanFollowUp?: boolean;
  callbackState?: 'pending' | 'success' | 'error';
}

// How many prior messages to send as conversation context (API allows 40).
const HISTORY_LIMIT = 20;

const TOPICS = [
  { label: 'Baggage', question: 'What is the baggage policy?' },
  { label: 'Pet Policy', question: 'What is the pet policy?' },
  { label: 'Airport Directions', question: 'How do I get directions to my departure airport?' },
  { label: 'FBOs', question: 'What are FBOs and which ones do you use?' },
  { label: 'Flight Questions', question: 'What should I know about Bluebird flights?' },
  { label: 'Membership', question: 'Tell me about membership tiers.' },
  { label: 'Queue System', question: 'How does the queue system work?' },
];

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default function ConciergeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  // Load persisted conversation history once on mount. The welcome message is
  // only shown when there is no prior history (fresh conversation).
  const historyQuery = useGetConciergeHistory({ limit: 50 });
  const historyLoaded = useRef(false);
  useEffect(() => {
    if (historyLoaded.current || !historyQuery.isSuccess) return;
    historyLoaded.current = true;
    const past: Message[] = (historyQuery.data ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.content,
      timestamp: new Date(m.createdAt),
      requiresHumanFollowUp: m.requiresHumanFollowUp,
      callbackState: m.callbackRequested ? 'success' : undefined,
    }));
    if (past.length > 0) {
      setMessages(prev => [...past, ...prev]);
    } else {
      setMessages(prev => [
        {
          id: 'welcome',
          role: 'assistant' as const,
          text: `Hi ${user?.name?.split(' ')[0] ?? 'there'} — I'm your AI Concierge. Ask me about baggage, pets, FBOs, directions, flights, membership, or queues.`,
          timestamp: new Date(),
        },
        ...prev,
      ]);
    }
  }, [historyQuery.isSuccess, historyQuery.data, user?.name]);

  const chatMutation = useConciergeChat();
  const callbackMutation = useRequestConciergeCallback();
  const isTyping = chatMutation.isPending;

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || chatMutation.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setInput('');

    const userMsg: Message = { id: makeId(), role: 'user', text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);

    // Send recent conversation history (excluding error bubbles) for context.
    const history = [...messages, userMsg]
      .filter(m => !m.isError && m.id !== 'welcome')
      .slice(-HISTORY_LIMIT)
      .map(m => ({ role: m.role, content: m.text }));

    try {
      const result = await chatMutation.mutateAsync({ data: { messages: history } });
      const assistantMsg: Message = {
        id: result.assistantMessageId,
        role: 'assistant',
        text: result.reply,
        timestamp: new Date(),
        requiresHumanFollowUp: result.requiresHumanFollowUp,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch {
      const errorMsg: Message = {
        id: makeId(),
        role: 'assistant',
        text: "Sorry, I couldn't reach the concierge just now. Please try again in a moment.",
        timestamp: new Date(),
        isError: true,
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const handleSend = () => {
    // Keep the keyboard up so the user can send another message right away
    inputRef.current?.focus();
    sendMessage(input);
  };

  const requestCallback = async (messageId: string) => {
    const current = messages.find((message) => message.id === messageId);
    if (!current?.requiresHumanFollowUp || current.callbackState === 'pending' || current.callbackState === 'success') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setMessages((prev) => prev.map((message) => message.id === messageId ? { ...message, callbackState: 'pending' } : message));
    try {
      await callbackMutation.mutateAsync({ data: { assistantMessageId: messageId } });
      setMessages((prev) => prev.map((message) => message.id === messageId ? { ...message, callbackState: 'success' } : message));
    } catch {
      setMessages((prev) => prev.map((message) => message.id === messageId ? { ...message, callbackState: 'error' } : message));
    }
  };

  const assistantBubbleBg = colors.scheme === 'dark' ? colors.secondary : colors.muted;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      // Opaque custom header: offset = status bar / notch inset + 60pt header row
      keyboardVerticalOffset={Platform.OS === 'web' ? 0 : insets.top + 60}
    >
      {historyQuery.isLoading && (
        <View style={styles.historyLoading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[styles.messageList, { paddingBottom: 16 }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.messageRow, item.role === 'user' && styles.messageRowUser]}>
            <View style={styles.messageBlock}>
              <View style={[
                styles.bubble,
                item.role === 'user'
                  ? [styles.bubbleUser, { backgroundColor: colors.primary }]
                  : [styles.bubbleAssistant, { backgroundColor: assistantBubbleBg }],
              ]}>
                <Text style={[
                  styles.bubbleText,
                  {
                    color: item.role === 'user' ? colors.primaryForeground : colors.foreground,
                    fontFamily: 'Inter_400Regular',
                  },
                ]}>{item.text}</Text>
              </View>
              {item.role === 'assistant' && item.requiresHumanFollowUp && (
                <View style={styles.callbackArea}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Request a callback from the Concierge team"
                    style={[
                      styles.callbackButton,
                      { backgroundColor: colors.primary },
                      (item.callbackState === 'pending' || item.callbackState === 'success') && styles.callbackButtonDisabled,
                    ]}
                    disabled={item.callbackState === 'pending' || item.callbackState === 'success'}
                    onPress={() => requestCallback(item.id)}
                  >
                    {item.callbackState === 'pending'
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Text style={[styles.callbackButtonText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
                          {item.callbackState === 'success' ? 'Callback Requested' : item.callbackState === 'error' ? 'Retry Callback Request' : 'Request a Callback'}
                        </Text>}
                  </TouchableOpacity>
                  {item.callbackState === 'success' && (
                    <Text accessibilityRole="alert" style={[styles.callbackStatus, { color: colors.success }]}>
                      Your request is with our Concierge team. A team member will contact you.
                    </Text>
                  )}
                  {item.callbackState === 'error' && (
                    <Text accessibilityRole="alert" style={[styles.callbackStatus, { color: colors.destructive }]}>
                      We couldn’t submit your request. Please try again.
                    </Text>
                  )}
                </View>
              )}
            </View>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            {isTyping && (
              <View style={styles.messageRow}>
                <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: assistantBubbleBg }]}>
                  <Text style={[styles.typingText, { color: colors.mutedForeground }]}>...</Text>
                </View>
              </View>
            )}

            {/* Topic chips — horizontal scroll, tap to send */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsRow}
              keyboardShouldPersistTaps="handled"
            >
              {TOPICS.map((t) => (
                <TouchableOpacity
                  key={t.label}
                  style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => sendMessage(t.question)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        }
      />

      {/* Input bar */}
      <View style={[styles.inputBar, { backgroundColor: colors.headerBackground, borderTopColor: colors.separator, paddingBottom: bottomPad + 8 }]}>
        <TextInput
          ref={inputRef}
          style={[styles.inputField, { backgroundColor: colors.input, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
          placeholder="Ask the AI Concierge..."
          placeholderTextColor={colors.mutedForeground}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          submitBehavior="submit"
          multiline={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: input.trim() ? 1 : 0.5 }]}
          onPress={handleSend}
          disabled={!input.trim()}
          activeOpacity={0.8}
        >
          <Feather name="arrow-up" size={18} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  historyLoading: { paddingTop: 24, alignItems: 'center' },
  messageList: { padding: 16, gap: 12 },
  messageRow: { flexDirection: 'row' },
  messageRowUser: { flexDirection: 'row-reverse' },
  messageBlock: { maxWidth: '82%', gap: 8 },
  bubble: { paddingHorizontal: 14, paddingVertical: 11 },
  bubbleAssistant: {
    borderRadius: 18,
    borderBottomLeftRadius: 6,
  },
  bubbleUser: {
    borderRadius: 18,
    borderBottomRightRadius: 6,
  },
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
  callbackArea: { gap: 6, alignItems: 'flex-start' },
  callbackButton: { minHeight: 42, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  callbackButtonDisabled: { opacity: 0.7 },
  callbackButtonText: { fontSize: 13 },
  callbackStatus: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  inputBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1 },
  inputField: {
    flex: 1, height: 44, borderRadius: 22,
    paddingHorizontal: 16, fontSize: 14,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
});
