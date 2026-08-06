import React from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useListNotifications, useMarkNotificationRead } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const TYPE_ICONS: Record<string, string> = {
  queue_update: 'list',
  flight_confirmed: 'check-circle',
  membership: 'star',
  referral: 'gift',
  system: 'bell',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: notifications, isLoading } = useListNotifications({});
  const readMutation = useMarkNotificationRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['listNotifications'] }),
    },
  });

  const items = (notifications as any[]) ?? [];

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {items.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="bell-off" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>No notifications</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            You'll be notified about queue updates and flight confirmations.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 24 }]}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.notifCard,
                { backgroundColor: item.read ? colors.card : colors.primary + '10', borderColor: item.read ? colors.border : colors.primary + '40' },
              ]}
              onPress={() => { if (!item.read) readMutation.mutate({ id: item.id }); }}
              activeOpacity={0.75}
            >
              <View style={[styles.iconWrap, { backgroundColor: item.read ? colors.secondary : colors.primary + '20' }]}>
                <Feather name={TYPE_ICONS[item.type] as any || 'bell'} size={16} color={item.read ? colors.mutedForeground : colors.primary} />
              </View>
              <View style={styles.notifContent}>
                <Text style={[styles.notifTitle, { color: colors.foreground, fontFamily: item.read ? 'Inter_400Regular' : 'Inter_600SemiBold' }]}>
                  {item.title}
                </Text>
                <Text style={[styles.notifBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {item.body}
                </Text>
                <Text style={[styles.notifTime, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {timeAgo(item.createdAt)}
                </Text>
              </View>
              {!item.read && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18 },
  emptyBody: { fontSize: 14, lineHeight: 22, textAlign: 'center', paddingHorizontal: 32 },
  listContent: { padding: 16, gap: 10 },
  notifCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  notifContent: { flex: 1, gap: 4 },
  notifTitle: { fontSize: 14, lineHeight: 20 },
  notifBody: { fontSize: 13, lineHeight: 18 },
  notifTime: { fontSize: 11, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
