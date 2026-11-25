import React from 'react';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
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
import { MemberSafetyDialogs } from '@/components/MemberSafetyDialogs';
import { presentMemberAccessClosed } from '@/lib/memberSafety';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { connectionMemberLabel, readMemberConnectionsSnapshot } from '@/lib/memberConnections';
import {
  classifyMemberMessageThreadScrollChange,
  conversationTitle,
  readMemberMessagesSnapshot,
  formatMemberMessageDaySeparator,
  isMemberMessageThreadNearBottom,
  limitMemberMessageBody,
  memberMessageBodyIssue,
  memberMessageComposerLengthWarning,
  memberMessageDayKey,
  memberMessageThreadPreserveScrollAfterPrepend,
  memberMessageThreadShouldAutoScroll,
  memberMessageThreadShowJumpButton,
} from '@/lib/memberMessages';
import { useMemberMessageThread } from '@/lib/useMemberMessages';

export function MemberMessageThread({ conversationId }: { conversationId: number | null }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const thread = useMemberMessageThread(conversationId);
  const session = useClerkAuthSnapshot();
  const [draft, setDraft] = React.useState('');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [safety, setSafety] = React.useState<null | { mode: 'report' | 'block'; messageId?: number }>(null);
  const [accessClosed, setAccessClosed] = React.useState(false);
  const [nearBottom, setNearBottom] = React.useState(true);
  const scrollRef = React.useRef<ScrollView>(null);
  const metricsRef = React.useRef({ scrollOffset: 0, layoutHeight: 0, contentHeight: 0 });
  const stickToBottomRef = React.useRef(true);
  const forceSendFollowRef = React.useRef(false);
  const pendingPrependRef = React.useRef<{ contentHeight: number; scrollOffset: number } | null>(null);
  const previousListRef = React.useRef<{
    newestId: number | null;
    oldestId: number | null;
    count: number;
  } | null>(null);
  const participantDirectory = React.useMemo(() => {
    const names = new Map<string, string>();
    const images = new Map<string, string>();
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const accountId = session?.isSignedIn === true ? session.userId : null;
    if (!configuration || !accountId) return { names, images };
    const snapshot = readMemberConnectionsSnapshot({
      environment: configuration.environment,
      apiBaseUrl: configuration.apiBaseUrl,
      clerkUserId: accountId,
    });
    for (const connection of snapshot?.accepted ?? []) {
      names.set(connection.member.userId, connectionMemberLabel(connection.member));
      if (
        connection.member.userId !== accountId
        && typeof connection.member.imageUrl === 'string'
        && connection.member.imageUrl
      ) {
        images.set(connection.member.userId, connection.member.imageUrl);
      }
    }
    const messages = readMemberMessagesSnapshot({
      environment: configuration.environment,
      apiBaseUrl: configuration.apiBaseUrl,
      clerkUserId: accountId,
    });
    for (const conversation of messages?.conversations ?? []) {
      if (
        conversation.participantUserId !== accountId
        && typeof conversation.imageUrl === 'string'
        && conversation.imageUrl
      ) {
        images.set(conversation.participantUserId, conversation.imageUrl);
      }
    }
    return { names, images };
  }, [session?.isSignedIn, session?.userId, thread.participantUserId]);
  const names = participantDirectory.names;
  const participantImageUrl = thread.participantUserId
    ? participantDirectory.images.get(thread.participantUserId) ?? null
    : null;
  const title = thread.participantUserId
    ? conversationTitle(thread.participantUserId, names)
    : 'Bluebird member';
  const issue = memberMessageBodyIssue(draft);
  const canSend = thread.enabled && thread.status === 'ready' && !thread.pending && issue === null;
  const topInset = Platform.OS === 'web' ? 16 : insets.top;
  const lengthWarning = memberMessageComposerLengthWarning(draft);
  const composerBottom = Math.max(insets.bottom, Platform.OS === 'web' ? 12 : 6);
  const showJump = memberMessageThreadShowJumpButton({
    nearBottom,
    hasMessages: thread.messages.length > 0,
  });

  React.useEffect(() => {
    previousListRef.current = null;
    stickToBottomRef.current = true;
    forceSendFollowRef.current = false;
    pendingPrependRef.current = null;
    setNearBottom(true);
    setDraft('');
    setMenuOpen(false);
    setSafety(null);
    setAccessClosed(false);
  }, [conversationId]);

  const scrollToLatest = React.useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const updateNearBottom = React.useCallback((
    scrollOffset: number,
    layoutHeight: number,
    contentHeight: number,
  ) => {
    metricsRef.current = { scrollOffset, layoutHeight, contentHeight };
    const nextNear = isMemberMessageThreadNearBottom({
      scrollOffset,
      layoutHeight,
      contentHeight,
    });
    stickToBottomRef.current = nextNear;
    setNearBottom((current) => (current === nextNear ? current : nextNear));
  }, []);

  React.useEffect(() => {
    const newestId = thread.messages[thread.messages.length - 1]?.id ?? null;
    const oldestId = thread.messages[0]?.id ?? null;
    const count = thread.messages.length;
    const change = classifyMemberMessageThreadScrollChange({
      previous: previousListRef.current,
      newestId,
      oldestId,
      count,
      forceSendFollow: forceSendFollowRef.current,
    });
    previousListRef.current = { newestId, oldestId, count };

    if (change === 'unchanged' || change === 'prepend') return;

    const shouldScroll = memberMessageThreadShouldAutoScroll({
      change,
      nearBottom: stickToBottomRef.current || forceSendFollowRef.current,
    });
    if (change === 'send') forceSendFollowRef.current = false;
    if (!shouldScroll) return;
    stickToBottomRef.current = true;
    setNearBottom(true);
    scrollToLatest(change !== 'open');
  }, [scrollToLatest, thread.messages]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    updateNearBottom(contentOffset.y, layoutMeasurement.height, contentSize.height);
  };

  const onContentSizeChange = (_width: number, height: number) => {
    const pending = pendingPrependRef.current;
    if (pending) {
      pendingPrependRef.current = null;
      const nextOffset = memberMessageThreadPreserveScrollAfterPrepend({
        previousContentHeight: pending.contentHeight,
        nextContentHeight: height,
        previousScrollOffset: pending.scrollOffset,
      });
      metricsRef.current = {
        ...metricsRef.current,
        contentHeight: height,
        scrollOffset: nextOffset,
      };
      scrollRef.current?.scrollTo({ y: nextOffset, animated: false });
      updateNearBottom(nextOffset, metricsRef.current.layoutHeight, height);
      return;
    }
    metricsRef.current = { ...metricsRef.current, contentHeight: height };
    if (stickToBottomRef.current || forceSendFollowRef.current) {
      scrollToLatest(false);
    }
  };

  const loadEarlier = () => {
    pendingPrependRef.current = {
      contentHeight: metricsRef.current.contentHeight,
      scrollOffset: metricsRef.current.scrollOffset,
    };
    void thread.loadEarlier();
  };

  const jumpToLatest = () => {
    forceSendFollowRef.current = false;
    stickToBottomRef.current = true;
    setNearBottom(true);
    scrollToLatest(true);
  };

  const send = () => {
    if (!canSend) return;
    const body = draft;
    forceSendFollowRef.current = true;
    stickToBottomRef.current = true;
    setNearBottom(true);
    void thread.send(body).then((sent) => {
      if (!sent) {
        forceSendFollowRef.current = false;
        return;
      }
      setDraft((current) => (current === body ? '' : current));
      scrollToLatest(true);
    });
  };

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.offWhite }]} behavior="padding" testID="member-message-thread">
      <View style={[styles.header, { paddingTop: topInset + 6 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" testID="member-message-back" onPress={() => router.back()} style={styles.back}>
          <Feather name="chevron-left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <MemberInitialsAvatar name={title} imageUrl={participantImageUrl} size={36} />
        <View style={styles.headerCopy}>
          <Text style={[styles.name, { color: colors.textOnSurface }]} numberOfLines={1}>{title}</Text>
        </View>
        {thread.participantUserId ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Conversation actions"
            testID="member-message-actions"
            onPress={() => setMenuOpen(true)}
            style={styles.back}
          >
            <Feather name="more-horizontal" size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
      </View>
      {!thread.enabled || thread.status === 'disabled' ? (
        <View style={styles.state} testID="member-message-unavailable">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Messages aren’t available yet</Text>
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
            Try again later.
          </Text>
        </View>
      ) : thread.status === 'signed-out' ? (
        <Text style={[styles.stateBody, { color: colors.textOnSurface }]} testID="member-message-signed-out">Sign in to view messages</Text>
      ) : accessClosed ? (
        <View style={styles.state} testID="member-message-access-closed">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>{presentMemberAccessClosed()}</Text>
        </View>
      ) : thread.status === 'loading' && thread.messages.length === 0 ? (
        <View style={styles.state} testID="member-message-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <View style={styles.threadPane}>
          <ScrollView
            ref={scrollRef}
            style={{ backgroundColor: colors.offWhite, flex: 1 }}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={16}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              updateNearBottom(metricsRef.current.scrollOffset, height, metricsRef.current.contentHeight);
            }}
            onContentSizeChange={onContentSizeChange}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            testID="member-message-scroll"
          >
            {thread.hasMore ? (
              <TouchableOpacity accessibilityRole="button" testID="member-message-earlier" onPress={loadEarlier} style={styles.earlier}>
                <Text style={[styles.earlierLabel, { color: colors.primary }]}>Load earlier messages</Text>
              </TouchableOpacity>
            ) : null}
            {thread.status === 'ready' && thread.messages.length === 0 ? (
              <Text style={[styles.stateTitle, { color: colors.textOnSurface }]} testID="member-message-empty">No messages yet</Text>
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
                    <Pressable
                      testID={`member-message-${message.id}`}
                      accessibilityHint={mine ? undefined : 'Report this message'}
                      delayLongPress={350}
                      onLongPress={mine ? undefined : () => {
                        if (!thread.participantUserId) return;
                        setSafety({ mode: 'report', messageId: message.id });
                      }}
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
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          {showJump ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Jump to latest message"
              testID="member-message-jump-latest"
              onPress={jumpToLatest}
              style={[styles.jump, { backgroundColor: colors.primary }]}
            >
              <Feather name="chevron-down" size={20} color={colors.primaryForeground} />
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      {thread.message ? (
        <Text style={[styles.feedback, { color: colors.textOnSurface }]} testID="member-message-feedback">{thread.message}</Text>
      ) : null}
      {thread.enabled && !accessClosed && thread.status !== 'disabled' && thread.status !== 'signed-out' ? (
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
      <MemberSafetyDialogs
        targetUserId={thread.participantUserId}
        mode={safety?.mode ?? null}
        messageId={safety?.messageId}
        onClose={() => setSafety(null)}
        onBlocked={() => setAccessClosed(true)}
      />
      {menuOpen && thread.participantUserId ? (
        <View style={styles.menuLayer} testID="member-message-action-menu">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close conversation actions"
            style={styles.menuOverlay}
            onPress={() => setMenuOpen(false)}
          />
          <View
            style={[
              styles.menu,
              {
                backgroundColor: colors.offWhite,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <TouchableOpacity
              accessibilityRole="button"
              testID="member-message-report"
              onPress={() => { setMenuOpen(false); setSafety({ mode: 'report' }); }}
              style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.menuLabel, { color: colors.textOnSurface }]}>Report member</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              testID="member-message-block"
              onPress={() => { setMenuOpen(false); setSafety({ mode: 'block' }); }}
              style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.menuLabel, { color: colors.destructive }]}>Block member</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              testID="member-message-actions-close"
              onPress={() => setMenuOpen(false)}
              style={[styles.menuCancel, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.menuLabel, { color: colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  menuLayer: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', zIndex: 3 },
  menuOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,17,40,0.45)' },
  menu: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  menuItem: { minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  menuCancel: { minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  menuLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  threadPane: { flex: 1 },
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
  jump: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
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
