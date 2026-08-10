import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useConciergeChat } from '@workspace/api-client-react';
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

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default function ConciergeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: `Welcome, ${user?.name?.split(' ')[0] ?? 'there'}! I'm your Bluebird AI Concierge. How can I help you today? Ask me about flights, membership, queue system, or anything else.`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const chatMutation = useConciergeChat();
  const isTyping = chatMutation.isPending;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setInput('');
    // Keep the keyboard up so the user can send another message right away
    inputRef.current?.focus();

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

  const SUGGESTIONS = ['What are empty legs?', 'How does the queue work?', 'Tell me about membership', 'How do referrals work?'];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      // Opaque native-stack header: offset = status bar / notch inset + standard 44pt header height
      keyboardVerticalOffset={Platform.OS === 'web' ? 0 : insets.top + 44}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[styles.messageList, { paddingBottom: 16 }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListHeaderComponent={
          <View style={styles.suggestionsRow}>
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.suggestion, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                onPress={() => { setInput(s); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.suggestionText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.messageRow, item.role === 'user' && styles.messageRowUser]}>
            {item.role === 'assistant' && (
              <View style={[styles.avatarBadge, { backgroundColor: colors.primary }]}>
                <Feather name="cpu" size={12} color={colors.primaryForeground} />
              </View>
            )}
            <View style={[
              styles.bubble,
              {
                backgroundColor: item.role === 'user' ? colors.primary : colors.card,
                borderColor: item.role === 'user' ? 'transparent' : colors.border,
              }
            ]}>
              <Text style={[styles.bubbleText, { color: item.role === 'user' ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_400Regular' }]}>{item.text}</Text>
            </View>
          </View>
        )}
        ListFooterComponent={isTyping ? (
          <View style={[styles.messageRow]}>
            <View style={[styles.avatarBadge, { backgroundColor: colors.primary }]}>
              <Feather name="cpu" size={12} color={colors.primaryForeground} />
            </View>
            <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.typingText, { color: colors.mutedForeground }]}>...</Text>
            </View>
          </View>
        ) : null}
      />

      {/* Input bar */}
      <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: bottomPad + 8 }]}>
        <TextInput
          ref={inputRef}
          style={[styles.inputField, { backgroundColor: colors.secondary, color: colors.foreground, fontFamily: 'Inter_400Regular', borderColor: colors.border }]}
          placeholder="Ask your concierge..."
          placeholderTextColor={colors.mutedForeground}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          submitBehavior="submit"
          multiline={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: input.trim() ? colors.primary : colors.secondary }]}
          onPress={handleSend}
          disabled={!input.trim()}
          activeOpacity={0.8}
        >
          <Feather name="send" size={16} color={input.trim() ? colors.primaryForeground : colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messageList: { padding: 16, gap: 12 },
  suggestionsRow: { flexWrap: 'wrap', flexDirection: 'row', gap: 8, marginBottom: 16 },
  suggestion: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  suggestionText: { fontSize: 12 },
  messageRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  messageRowUser: { flexDirection: 'row-reverse' },
  avatarBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  bubble: { maxWidth: '78%', borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  typingText: { fontSize: 18, letterSpacing: 2 },
  inputBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1 },
  inputField: {
    flex: 1, height: 44, borderRadius: 22, borderWidth: 1,
    paddingHorizontal: 16, fontSize: 14,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
});
