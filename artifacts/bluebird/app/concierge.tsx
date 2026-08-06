import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

const CONCIERGE_RESPONSES: Record<string, string> = {
  'default': "I'm here to help with your Bluebird experience. Ask me about flights, membership, or anything else!",
  'flight': "Empty leg flights are repositioning trips available to Bluebird members at no cost. Browse the Discover tab to see current available flights and join a queue.",
  'membership': "Bluebird offers Base, Plus, and Concierge tiers. Plus members get 2 Skip the Line passes per month, while Concierge members enjoy unlimited passes and 24/7 AI support.",
  'queue': "The queue system lets you request a seat on any available empty leg flight. Skip the Line passes move you to the front of the queue instantly.",
  'pass': "Skip the Line passes are earned through Plus/Concierge membership and referrals. Each pass guarantees you the next available seat on your chosen flight.",
  'referral': "Earn 1 Skip the Line pass for every friend who joins Bluebird using your referral code. Find your code in the Referral section of your profile.",
  'international': "International empty leg flights require a valid passport. Bluebird currently operates domestic US routes, with international access available on Plus membership.",
  'luggage': "Luggage allowances vary by aircraft type. Generally expect 1-2 bags per seat. Specific allowances are communicated upon flight confirmation.",
  'cancel': "Cancellations: You can leave a queue at any time without penalty. Skip the Line passes are not refunded if a flight is cancelled by the operator.",
  'help': "I can help with: flight information, queue system, membership perks, referrals, luggage policies, and general aviation questions. What would you like to know?",
};

function getResponse(text: string): string {
  const lower = text.toLowerCase();
  for (const [key, response] of Object.entries(CONCIERGE_RESPONSES)) {
    if (key !== 'default' && lower.includes(key)) {
      return response;
    }
  }
  return CONCIERGE_RESPONSES.default;
}

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
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setInput('');

    const userMsg: Message = { id: makeId(), role: 'user', text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
    const reply = getResponse(text);
    const assistantMsg: Message = { id: makeId(), role: 'assistant', text: reply, timestamp: new Date() };
    setMessages(prev => [...prev, assistantMsg]);
    setIsTyping(false);
  };

  const SUGGESTIONS = ['What are empty legs?', 'How does the queue work?', 'Tell me about membership', 'How do referrals work?'];

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[styles.messageList, { paddingBottom: 16 }]}
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
                <Feather name="cpu" size={12} color="#fff" />
              </View>
            )}
            <View style={[
              styles.bubble,
              {
                backgroundColor: item.role === 'user' ? colors.primary : colors.card,
                borderColor: item.role === 'user' ? 'transparent' : colors.border,
              }
            ]}>
              <Text style={[styles.bubbleText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>{item.text}</Text>
            </View>
          </View>
        )}
        ListFooterComponent={isTyping ? (
          <View style={[styles.messageRow]}>
            <View style={[styles.avatarBadge, { backgroundColor: colors.primary }]}>
              <Feather name="cpu" size={12} color="#fff" />
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
          style={[styles.inputField, { backgroundColor: colors.secondary, color: colors.foreground, fontFamily: 'Inter_400Regular', borderColor: colors.border }]}
          placeholder="Ask your concierge..."
          placeholderTextColor={colors.mutedForeground}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: input.trim() ? colors.primary : colors.secondary }]}
          onPress={handleSend}
          disabled={!input.trim()}
          activeOpacity={0.8}
        >
          <Feather name="send" size={16} color={input.trim() ? '#fff' : colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messageList: { padding: 16, gap: 12 },
  suggestionsRow: { flexWrap: 'wrap', flexDirection: 'row', gap: 8, marginBottom: 16 },
  suggestion: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
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
