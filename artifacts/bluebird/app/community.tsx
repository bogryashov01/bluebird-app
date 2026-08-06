import React from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

const POSTS = [
  { id: '1', author: 'Sarah M.', tier: 'concierge', time: '2h ago', text: 'Just landed in Aspen after a beautiful DEN → ASP flight. Zero turbulence, stunning views. Bluebird never disappoints. ✈️', likes: 24, comments: 7 },
  { id: '2', author: 'James K.', tier: 'plus', time: '5h ago', text: 'Pro tip: check the Discover tab on Tuesday mornings. Operators usually upload new empty legs for the weekend. Got 3 flights this way!', likes: 47, comments: 12 },
  { id: '3', author: 'Priya R.', tier: 'concierge', time: '1d ago', text: 'Used my first Skip the Line pass for the JFK → MIA route. Was #1 in queue and confirmed within minutes. The concierge tier is worth every penny.', likes: 31, comments: 9 },
  { id: '4', author: 'Marcus T.', tier: 'base', time: '2d ago', text: 'New member here! Any tips for someone just starting out on the Base plan? Looking to get my first flight.', likes: 15, comments: 23 },
  { id: '5', author: 'Elena V.', tier: 'plus', time: '3d ago', text: 'The referral program is incredible. Invited 4 friends, got 4 Skip the Line passes. Already used two of them. Community here is fantastic too. 🙌', likes: 56, comments: 18 },
];

const TIER_COLORS: Record<string, string> = {
  base: '#8896B3',
  plus: '#1259F2',
  concierge: '#F59E0B',
};

export default function CommunityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={POSTS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 24 }]}
        ListHeaderComponent={(
          <View style={[styles.banner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
            <Feather name="users" size={18} color={colors.primary} />
            <Text style={[styles.bannerText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
              Welcome to the Bluebird community — tips, stories, and connections from fellow members.
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={[styles.postCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.postHeader}>
              <View style={[styles.authorAvatar, { backgroundColor: TIER_COLORS[item.tier] + '30' }]}>
                <Text style={[styles.authorInitial, { color: TIER_COLORS[item.tier], fontFamily: 'Inter_700Bold' }]}>
                  {item.author[0]}
                </Text>
              </View>
              <View style={styles.authorInfo}>
                <View style={styles.authorNameRow}>
                  <Text style={[styles.authorName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{item.author}</Text>
                  <View style={[styles.tierBadge, { backgroundColor: TIER_COLORS[item.tier] + '20' }]}>
                    <Text style={[styles.tierBadgeText, { color: TIER_COLORS[item.tier], fontFamily: 'Inter_500Medium' }]}>
                      {item.tier}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.postTime, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{item.time}</Text>
              </View>
            </View>

            <Text style={[styles.postText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>{item.text}</Text>

            <View style={[styles.postActions, { borderTopColor: colors.border }]}>
              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
                <Feather name="heart" size={15} color={colors.mutedForeground} />
                <Text style={[styles.actionCount, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{item.likes}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
                <Feather name="message-circle" size={15} color={colors.mutedForeground} />
                <Text style={[styles.actionCount, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{item.comments}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
                <Feather name="share-2" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 16, gap: 14 },
  banner: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 4, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 19 },
  postCard: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  postHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  authorAvatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  authorInitial: { fontSize: 16 },
  authorInfo: { flex: 1 },
  authorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  authorName: { fontSize: 14 },
  tierBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  tierBadgeText: { fontSize: 10 },
  postTime: { fontSize: 12, marginTop: 2 },
  postText: { fontSize: 14, lineHeight: 22 },
  postActions: { flexDirection: 'row', gap: 20, borderTopWidth: 1, paddingTop: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionCount: { fontSize: 13 },
});
