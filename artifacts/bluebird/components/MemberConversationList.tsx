import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { MemberInitialsAvatar } from '@/components/MemberProfileSheet';
import { useColors } from '@/hooks/useColors';
import { formatMemberActivityTime } from '@/lib/memberConnectPresentation';
import { conversationTitle, formatMemberMessagesUnreadBadge } from '@/lib/memberMessages';
import { useMemberConversations } from '@/lib/useMemberMessages';

function ConversationListSkeleton({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.list} testID="member-messages-skeleton">
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={[styles.row, styles.skeletonRow, { borderBottomColor: colors.separator }]}
        >
          <View style={[styles.skeletonAvatar, { backgroundColor: colors.surface }]} />
          <View style={styles.rowCopy}>
            <View style={[styles.skeletonLine, styles.skeletonTitle, { backgroundColor: colors.surface }]} />
            <View style={[styles.skeletonLine, styles.skeletonPreview, { backgroundColor: colors.surface }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function MemberConversationList({
  names,
  images,
  active,
  bottomInset = 24,
}: {
  names: ReadonlyMap<string, string>;
  images?: ReadonlyMap<string, string>;
  active: boolean;
  bottomInset?: number;
}) {
  const colors = useColors();
  const inbox = useMemberConversations(active);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const view = inbox.view;

  React.useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    return undefined;
  }, [active, inbox.conversations]);

  if (view.kind === 'disabled') {
    return (
      <View style={styles.state} testID="member-connections-messages-unavailable">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Messages aren’t available yet</Text>
        <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
          Try again later.
        </Text>
      </View>
    );
  }

  if (view.kind === 'signed-out') {
    return (
      <View style={styles.state} testID="member-messages-signed-out">
        <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Sign in to view messages</Text>
      </View>
    );
  }

  if (view.kind === 'skeleton') {
    return (
      <ScrollView
        testID="member-messages-list"
        style={{ backgroundColor: colors.offWhite }}
        contentContainerStyle={{ paddingBottom: bottomInset }}
      >
        <ConversationListSkeleton colors={colors} />
      </ScrollView>
    );
  }

  if (view.kind === 'error') {
    return (
      <View style={styles.state} testID="member-messages-error">
        <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Messages couldn’t be loaded</Text>
        <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
          {view.message || 'Try again.'}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          testID="member-messages-retry"
          onPress={() => { void inbox.refresh(); }}
          style={styles.retry}
        >
          <Text style={[styles.retryLabel, { color: colors.primary }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      testID="member-messages-list"
      style={{ backgroundColor: colors.offWhite }}
      contentContainerStyle={[styles.list, { paddingBottom: bottomInset }]}
      refreshControl={(
        <RefreshControl
          refreshing={view.kind === 'list' ? view.refreshing : inbox.refreshing}
          onRefresh={() => { void inbox.refresh(); }}
          tintColor={colors.primary}
          progressBackgroundColor={colors.surface}
        />
      )}
    >
      {view.kind === 'list' && view.message ? (
        <Text style={[styles.meta, { color: colors.textOnSurface }]} testID="member-messages-feedback">{view.message}</Text>
      ) : null}
      {view.kind === 'list' && view.message ? (
        <TouchableOpacity accessibilityRole="button" testID="member-messages-retry" onPress={() => { void inbox.refresh(); }} style={styles.retry}>
          <Text style={[styles.retryLabel, { color: colors.primary }]}>Try again</Text>
        </TouchableOpacity>
      ) : null}
      {view.kind === 'empty' ? (
        <View testID="member-messages-empty" style={styles.empty}>
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>No messages yet</Text>
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>Your conversations will appear here.</Text>
        </View>
      ) : null}
      {view.kind === 'list' ? view.conversations.map((conversation) => {
        const title = conversationTitle(conversation.participantUserId, names);
        const activity = conversation.latestMessage?.createdAt ?? conversation.updatedAt;
        const unreadBadge = formatMemberMessagesUnreadBadge(conversation.unreadCount);
        return (
          <TouchableOpacity
            key={conversation.id}
            accessibilityRole="button"
            testID={`member-messages-row-${conversation.id}`}
            onPress={() => router.push({
              pathname: '/messages/[conversationId]',
              params: { conversationId: String(conversation.id) },
            })}
            style={[styles.row, { borderBottomColor: colors.separator }]}
          >
            <MemberInitialsAvatar
              name={title}
              imageUrl={conversation.imageUrl ?? images?.get(conversation.participantUserId) ?? null}
            />
            <View style={styles.rowCopy}>
              <View style={styles.titleLine}>
                <Text style={[styles.name, { color: colors.textOnSurface }]} numberOfLines={1}>{title}</Text>
                <Text style={[styles.time, { color: colors.mutedForegroundLight }]}>
                  {formatMemberActivityTime(activity, nowMs)}
                </Text>
              </View>
              <Text style={[styles.preview, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                {conversation.latestMessage?.body ?? 'No messages yet'}
              </Text>
            </View>
            {unreadBadge ? (
              <View style={[styles.badge, { backgroundColor: colors.primary }]} testID={`member-messages-unread-${conversation.id}`}>
                <Text style={[styles.badgeLabel, { color: colors.primaryForeground }]}>{unreadBadge}</Text>
              </View>
            ) : null}
            <Feather name="chevron-right" size={18} color={colors.mutedForegroundLight} />
          </TouchableOpacity>
        );
      }) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: 4 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 20, marginBottom: 4 },
  row: { minHeight: 76, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  skeletonRow: { opacity: 0.9 },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22 },
  skeletonLine: { borderRadius: 6 },
  skeletonTitle: { height: 14, width: '46%' },
  skeletonPreview: { height: 12, width: '72%', marginTop: 8 },
  rowCopy: { flex: 1, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  time: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  preview: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 18 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, paddingHorizontal: 20 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeLabel: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  retry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 20 },
  retryLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  empty: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 36, gap: 6 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 28, paddingTop: 20 },
});
