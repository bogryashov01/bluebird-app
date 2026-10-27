import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { parseJoinFlightDisplay } from '@/lib/joinFlightPresentation';
import {
  DEMO_CONCIERGE_PROMPTS,
  appendDemoConciergeExchange,
  createDemoConciergeWelcome,
  demoConciergeRouteLabel,
  type DemoConciergeMessage,
} from '@/lib/demoConcierge';

const REPLY_DELAY_MS = 450;

function formatDemoTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function DemoConciergeChat() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const flight = parseJoinFlightDisplay(params);
  const routeLabel = demoConciergeRouteLabel(flight);
  const context = useMemo(() => ({ routeLabel }), [routeLabel]);
  const [messages, setMessages] = useState<DemoConciergeMessage[]>(() => [
    createDemoConciergeWelcome(new Date().toISOString()),
  ]);
  const [input, setInput] = useState('');
  const [replying, setReplying] = useState(false);
  const listRef = useRef<FlatList<DemoConciergeMessage>>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomPad = Platform.OS === 'web' ? 20 : insets.bottom;

  useEffect(() => () => {
    if (replyTimer.current) clearTimeout(replyTimer.current);
  }, []);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || replying) return;
    Keyboard.dismiss();
    setInput('');
    setReplying(true);
    replyTimer.current = setTimeout(() => {
      setMessages((current) => appendDemoConciergeExchange(current, text, new Date().toISOString(), context));
      setReplying(false);
    }, REPLY_DELAY_MS);
  };

  return (
    <KeyboardAvoidingView
      testID="demo-concierge-screen"
      style={[styles.screen, { backgroundColor: colors.offWhite }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListHeaderComponent={
          <View style={styles.intro}>
            <View style={[styles.badge, { backgroundColor: colors.primary + '14' }]}>
              <Text testID="demo-concierge-badge" style={[styles.badgeText, { color: colors.primary }]}>DEMO</Text>
            </View>
            <Text style={[styles.introText, { color: colors.mutedForegroundLight }]}>
              Prepared answers stay on this device. No message, request, or booking is sent.
            </Text>
            {routeLabel ? (
              <View testID="demo-concierge-flight-context" style={[styles.context, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
                <Text style={[styles.contextLabel, { color: colors.mutedForegroundLight }]}>Opened from</Text>
                <Text style={[styles.contextRoute, { color: colors.textOnSurface }]}>{routeLabel}</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const mine = item.role === 'user';
          return (
            <View style={[styles.row, mine && styles.rowMine]}>
              <View style={[
                styles.bubble,
                mine ? styles.bubbleMine : styles.bubbleTheirs,
                mine
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.surface, borderColor: colors.separator },
              ]}>
                <Text style={[styles.body, { color: mine ? colors.primaryForeground : colors.textOnSurface }]}>
                  {item.text}
                </Text>
                <Text style={[styles.time, { color: mine ? colors.primaryForeground : colors.mutedForegroundLight }]}>
                  {formatDemoTime(item.createdAt)}
                </Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={replying ? (
          <View testID="demo-concierge-typing" style={styles.row}>
            <View style={[styles.bubble, styles.typing, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>•••</Text>
            </View>
          </View>
        ) : null}
      />
      <View style={[styles.composer, { backgroundColor: colors.offWhite, borderTopColor: colors.separator, paddingBottom: bottomPad + 10 }]}>
        <View style={styles.chips}>
          {DEMO_CONCIERGE_PROMPTS.map((prompt) => (
            <TouchableOpacity
              key={prompt.id}
              testID={`demo-concierge-chip-${prompt.id}`}
              accessibilityRole="button"
              accessibilityLabel={prompt.label}
              disabled={replying}
              onPress={() => send(prompt.question)}
              style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.separator, opacity: replying ? 0.5 : 1 }]}
            >
              <Text style={[styles.chipText, { color: colors.textOnSurface }]}>{prompt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.inputRow}>
          <TextInput
            testID="demo-concierge-input"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input)}
            placeholder="Ask about a queue, membership, or flight"
            placeholderTextColor={colors.mutedForegroundLight}
            editable={!replying}
            returnKeyType="send"
            style={[styles.input, { backgroundColor: colors.surface, color: colors.textOnSurface, borderColor: colors.separator }]}
          />
          <TouchableOpacity
            testID="demo-concierge-send"
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!input.trim() || replying}
            onPress={() => send(input)}
            style={[styles.send, { backgroundColor: colors.primary, opacity: input.trim() && !replying ? 1 : 0.45 }]}
          >
            <Feather name="arrow-up" size={18} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  messages: { paddingHorizontal: 16, paddingBottom: 12 },
  intro: { paddingTop: 16, paddingBottom: 8, gap: 10 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6 },
  introText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  context: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  contextLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  contextRoute: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 2 },
  row: { flexDirection: 'row', marginTop: 10 },
  rowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11, gap: 6 },
  bubbleTheirs: { borderBottomLeftRadius: 6, borderWidth: 1 },
  bubbleMine: { borderBottomRightRadius: 6 },
  typing: { borderWidth: 1 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21 },
  time: { fontFamily: 'Inter_400Regular', fontSize: 11, alignSelf: 'flex-end' },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  input: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 23,
    paddingHorizontal: 16,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
