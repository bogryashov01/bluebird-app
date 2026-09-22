import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useListNetworkingConnections } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export default function NetworkingConnectionsScreen() {
  const colors = useColors();
  const { data, isLoading, isError, refetch } = useListNetworkingConnections({ query: { refetchOnMount: 'always', refetchInterval: 15000 } });
  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.offWhite }]}><ActivityIndicator color={colors.primary} /></View>;
  if (isError) return <View style={[styles.center, { backgroundColor: colors.offWhite }]}><Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Could not load messages.</Text><TouchableOpacity onPress={() => refetch()}><Text style={[styles.link, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View>;
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[styles.list, { backgroundColor: colors.offWhite }]}
      ListEmptyComponent={<View style={styles.center}><Text style={[styles.title, { color: colors.textOnSurface }]}>No connections yet</Text><Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Accepted introductions will become conversations here.</Text></View>}
      renderItem={({ item }) => (
        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surface }]} onPress={() => router.push({ pathname: '/networking/connections/[id]' as any, params: { id: item.id, name: item.member.firstName } })} activeOpacity={0.75}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + '18' }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{item.member.firstName?.[0] ?? '?'}</Text></View>
          <View style={styles.content}>
            <Text style={[styles.name, { color: colors.textOnSurface }]}>{item.member.firstName} {item.member.lastName}</Text>
            <Text style={[styles.industry, { color: colors.mutedForegroundLight }]}>{item.member.industry}</Text>
            <Text style={[styles.preview, { color: colors.mutedForegroundLight }]} numberOfLines={1}>{item.lastMessage?.content ?? item.member.bio}</Text>
          </View>
          <Text style={[styles.chevron, { color: colors.mutedForegroundLight }]}>›</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  card: { borderRadius: 18, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  content: { flex: 1, gap: 3 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  industry: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  preview: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 5 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  chevron: { fontSize: 24 },
});