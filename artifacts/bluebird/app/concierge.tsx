import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, ScrollView, Linking,
  TouchableOpacity, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useConciergeChat, useGetConciergeHistory } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  isError?: boolean;
}

// How many prior messages to send as conversation context (API allows 40).
const HISTORY_LIMIT = 20;

const CONCIERGE_PHONE = '+18005550137';

const TOPICS = [
  { label: 'Baggage', question: 'What is the baggage policy?' },
  { label: 'Pet Policy', question: 'What is the pet policy?' },
  { label: 'Airport Directions', question: 'How do I get directions to my departure airport?' },
  { label: 'FBOs', question: 'What are FBOs and which ones do you use?' },
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
  // Web-only inline fallback: Alert buttons are no-ops on react-native-web.
  const [showCallFallback, setShowCallFallback] = useState(false);
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
    }));
    if (past.length > 0) {
      setMessages(prev => [...past, ...prev]);
    } else {
      setMessages(prev => [
        {
          id: 'welcome',
          role: 'assistant' as const,
          text: `Hi ${user?.name?.split(' ')[0] ?? 'there'} — I'm your AI Concierge. Ask me about baggage, pets, FBOs, airports or your membership.`,
          timestamp: new Date(),
        },
        ...prev,
      ]);
    }
  }, [historyQuery.isSuccess, historyQuery.data, user?.name]);

  const chatMutation = useConciergeChat();
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
      const assistantMsg: Message = { id: makeId(), role: 'assistant', text: result.reply, timestamp: new Date() };
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

  const handleCallConcierge = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (Platform.OS === 'web') {
      // Alert.alert buttons are no-ops on react-native-web — show an inline
      // fallback with a tappable phone link instead.
      setShowCallFallback(true);
      return;
    }
    Alert.alert(
      'Call Concierge',
      'Connect with a live concierge now?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call',
          onPress: () => Linking.openURL(`tel:${CONCIERGE_PHONE}`).catch(() => {}),
        },
      ],
    );
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

            {/* Escalation banner */}
            <LinearGradient
              colors={[colors.backgroundMid, colors.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.banner}
            >
              <View style={styles.bannerTextBlock}>
                <Text style={[styles.bannerTitle, { color: colors.textOnBrand, fontFamily: 'Inter_600SemiBold' }]}>
                  Need a human?
                </Text>
                <Text style={[styles.bannerSubtitle, { color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_400Regular' }]}>
                  Escalate to a live concierge anytime.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.bannerBtn}
                onPress={handleCallConcierge}
                activeOpacity={0.8}
              >
                <Text style={[styles.bannerBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                  Call Concierge
                </Text>
              </TouchableOpacity>
            </LinearGradient>

            {showCallFallback && (
              <View style={[styles.callFallback, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="phone" size={14} color={colors.primary} />
                <Text style={[styles.callFallbackText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                  Reach a live concierge at{' '}
                  <Text
                    style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}
                    onPress={() => Linking.openURL(`tel:${CONCIERGE_PHONE}`).catch(() => {})}
                  >
                    {CONCIERGE_PHONE}
                  </Text>
                </Text>
              </View>
            )}
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
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 11 },
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
  banner: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerTextBlock: { flex: 1 },
  bannerTitle: { fontSize: 14.5 },
  bannerSubtitle: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  bannerBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bannerBtnText: { fontSize: 13 },
  callFallback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  callFallbackText: { fontSize: 13, flex: 1 },
  inputBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1 },
  inputField: {
    flex: 1, height: 44, borderRadius: 22,
    paddingHorizontal: 16, fontSize: 14,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
});
