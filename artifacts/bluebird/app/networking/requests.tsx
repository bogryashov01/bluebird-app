import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useListIncomingNetworkingRequests, useDecideNetworkingRequest } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';

export default function NetworkingRequestsScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useListIncomingNetworkingRequests({ query: { refetchOnMount: 'always' } });
  const decision = useDecideNetworkingRequest();
  const requests = data ?? [];

  const act = (id: string, action: 'accept' | 'decline' | 'ignore' | 'block' | 'report') => {
    decision.mutate({ id, data: { action } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/networking/requests/incoming'] }),
    });
  };
  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.offWhite }]}><ActivityIndicator color={colors.primary} /></View>;
  if (isError) return <View style={[styles.center, { backgroundColor: colors.offWhite }]}><Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Could not load requests.</Text><TouchableOpacity onPress={() => refetch()}><Text style={[styles.link, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View>;
  return (
    <FlatList
      data={requests}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[styles.list, { backgroundColor: colors.offWhite }]}
      ListEmptyComponent={<View style={styles.center}><Text style={[styles.title, { color: colors.textOnSurface }]}>No new requests</Text><Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Introductions from other members will appear here.</Text></View>}
      renderItem={({ item }) => {
        const requester = item.requester;
        const name = requester?.firstName ?? 'A member';
        return (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={[styles.avatar, { backgroundColor: colors.primary + '18' }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{requester?.firstName?.[0] ?? '?'}</Text></View>
            <View style={styles.content}>
              <Text style={[styles.name, { color: colors.textOnSurface }]}>{name}</Text>
              <Text style={[styles.industry, { color: colors.mutedForegroundLight }]}>{requester?.industry ?? 'Bluebird member'}</Text>
              <Text style={[styles.message, { color: colors.textOnSurface }]}>{item.message}</Text>
              {item.flight ? <Text style={[styles.flight, { color: colors.mutedForegroundLight }]}>{item.flight.fromCity} → {item.flight.toCity} · {item.flight.departureDate}</Text> : null}
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.primaryAction, { backgroundColor: colors.primary }]} onPress={() => act(item.id, 'accept')} disabled={decision.isPending}><Text style={[styles.actionText, { color: colors.primaryForeground }]}>Accept</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.secondaryAction, { borderColor: colors.border }]} onPress={() => act(item.id, 'decline')} disabled={decision.isPending}><Text style={[styles.actionText, { color: colors.textOnSurface }]}>Decline</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => act(item.id, 'ignore')} disabled={decision.isPending}><Text style={[styles.smallAction, { color: colors.mutedForegroundLight }]}>Remove</Text></TouchableOpacity>
              </View>
              <View style={styles.safety}><TouchableOpacity onPress={() => act(item.id, 'block')}><Text style={[styles.smallAction, { color: colors.destructive }]}>Block</Text></TouchableOpacity><TouchableOpacity onPress={() => act(item.id, 'report')}><Text style={[styles.smallAction, { color: colors.destructive }]}>Report</Text></TouchableOpacity></View>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  card: { borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  content: { flex: 1, gap: 4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  industry: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  message: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 8 },
  flight: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  primaryAction: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  secondaryAction: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  smallAction: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  safety: { flexDirection: 'row', gap: 16, marginTop: 9 },
});