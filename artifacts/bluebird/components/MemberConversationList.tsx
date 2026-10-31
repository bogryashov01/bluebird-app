import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { conversationTitle } from '@/lib/memberMessages';
import { useMemberConversations } from '@/lib/useMemberMessages';

export function MemberConversationList({
  names,
  active,
}: {
  names: ReadonlyMap<string, string>;
  active: boolean;
}) {
  const colors = useColors();
  const inbox = useMemberConversations(active);

  if (!inbox.enabled || inbox.status === 'disabled') {
    return (
      <View style={styles.state} testID="member-connections-messages-unavailable">
        <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Messages are not available yet</Text>
        <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
          Private messages stay off until that service is ready.
        </Text>
      </View>
    );
  }

  if (inbox.status === 'signed-out') {
    return (
      <View style={styles.state} testID="member-messages-signed-out">
        <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Sign in to view messages</Text>
      </View>
    );
  }

  if (inbox.status === 'loading' && inbox.conversations.length === 0) {
    return (
      <View style={styles.state} testID="member-messages-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      testID="member-messages-list"
      contentContainerStyle={styles.list}
      refreshControl={(
        <RefreshControl
          refreshing={inbox.refreshing}
          onRefresh={() => { void inbox.refresh(); }}
          tintColor={colors.primary}
        />
      )}
    >
      {inbox.message ? (
        <Text style={[styles.meta, { color: colors.textOnSurface }]} testID="member-messages-feedback">{inbox.message}</Text>
      ) : null}
      {inbox.status === 'error' ? (
        <TouchableOpacity accessibilityRole="button" testID="member-messages-retry" onPress={() => { void inbox.refresh(); }} style={styles.retry}>
          <Text style={[styles.retryLabel, { color: colors.primary }]}>Try again</Text>
        </TouchableOpacity>
      ) : null}
      {inbox.unreadCount > 0 ? (
        <Text style={[styles.meta, { color: colors.mutedForegroundLight }]} testID="member-messages-unread-total">
          {inbox.unreadCount === 1 ? '1 unread message' : `${inbox.unreadCount} unread messages`}
        </Text>
      ) : null}
      {inbox.conversations.length === 0 && inbox.status === 'ready' ? (
        <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]} testID="member-messages-empty">
          No conversations yet. Message an accepted connection to start one.
        </Text>
      ) : null}
      {inbox.conversations.map((conversation) => {
        const title = conversationTitle(conversation.participantUserId, names);
        return (
          <TouchableOpacity
            key={conversation.id}
            accessibilityRole="button"
            testID={`member-messages-row-${conversation.id}`}
            onPress={() => router.push({
              pathname: '/messages/[conversationId]',
              params: { conversationId: String(conversation.id) },
            })}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <View style={styles.rowCopy}>
              <Text style={[styles.name, { color: colors.textOnSurface }]} numberOfLines={1}>{title}</Text>
              <Text style={[styles.meta, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                {conversation.latestMessage?.body ?? 'No messages yet'}
              </Text>
            </View>
            {conversation.unreadCount > 0 ? (
              <View style={[styles.badge, { backgroundColor: colors.primary }]} testID={`member-messages-unread-${conversation.id}`}>
                <Text style={[styles.badgeLabel, { color: colors.primaryForeground }]}>{conversation.unreadCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: 8, paddingBottom: 24 },
  row: { minHeight: 72, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, gap: 2 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, paddingHorizontal: 20 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeLabel: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  retry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 20 },
  retryLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 28, paddingTop: 12 },
});
