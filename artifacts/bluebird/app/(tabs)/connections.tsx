import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  getListIncomingNetworkingRequestsQueryKey,
  getListNetworkingConnectionsQueryKey,
  useListNetworkingConnections,
  useRestoreNetworkingDemoSamples,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type HubView = 'connections' | 'messages';

export default function ConnectionsHubScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const initialView: HubView = view === 'messages' ? 'messages' : 'connections';
  const [activeView, setActiveView] = React.useState<HubView>(initialView);
  const [restoreFeedback, setRestoreFeedback] = React.useState('');
  const { data, isLoading, isError, isRefetching, refetch } = useListNetworkingConnections({
    query: { refetchOnMount: 'always', refetchInterval: 15000 },
  });
  const restoreSamples = useRestoreNetworkingDemoSamples();
  const refetchRef = React.useRef(refetch);
  const connections = data ?? [];

  React.useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  React.useEffect(() => {
    if (view === 'connections' || view === 'messages') setActiveView(view);
  }, [view]);

  useFocusEffect(
    React.useCallback(() => {
      void refetchRef.current();
    }, []),
  );

  const selectView = (nextView: HubView) => {
    setActiveView(nextView);
    router.setParams({ view: nextView });
  };

  const restoreNetworkingSamples = () => {
    setRestoreFeedback('');
    restoreSamples.mutate(undefined, {
      onSuccess: () => {
        setRestoreFeedback('Sample networking data restored.');
        void queryClient.invalidateQueries({ queryKey: getListNetworkingConnectionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListIncomingNetworkingRequestsQueryKey() });
      },
      onError: () => setRestoreFeedback('Could not restore sample data. Try again.'),
    });
  };

  const messageConnections =
    activeView === 'messages'
      ? [...connections].sort((a, b) => {
          const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
          const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
          return bTime - aTime;
        })
      : connections;

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 110 : insets.bottom + 96;
  const visibleConnections = isLoading || isError ? [] : messageConnections;

  const emptyState = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.emptyBody, { color: colors.mutedForegroundLight }]}>
            Loading {activeView === 'messages' ? 'messages' : 'connections'}…
          </Text>
        </View>
      );
    }
    if (isError) {
      return (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.textOnSurface }]}>
            Couldn’t load {activeView === 'messages' ? 'messages' : 'connections'}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForegroundLight }]}>
            Check your connection and try again.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            testID="connections-retry"
            style={[styles.retryButton, { borderColor: colors.border }]}
            onPress={() => void refetch()}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeView === 'messages' && connections.length > 0) return null;

    return (
      <View style={styles.emptyState}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
          <Feather
            name={activeView === 'messages' ? 'message-circle' : 'users'}
            size={22}
            color={colors.primary}
          />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.textOnSurface }]}>
          {activeView === 'messages' ? 'No conversations yet' : 'No connections yet'}
        </Text>
        <Text style={[styles.emptyBody, { color: colors.mutedForegroundLight }]}>
          {activeView === 'messages'
            ? 'Accepted connections will appear here, even before you send the first message.'
            : 'Accepted introductions will appear here. Check your requests for new introductions.'}
        </Text>
        {activeView === 'messages' ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => selectView('connections')}
            style={[styles.retryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>View connections</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <View style={[styles.header, { paddingTop: topInset + 14 }]}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>YOUR NETWORK</Text>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Connections</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
          Keep up with the members you’ve met.
        </Text>

        <View
          accessibilityRole="tablist"
          style={[styles.segmentedControl, { backgroundColor: colors.muted }]}
        >
          {(['connections', 'messages'] as const).map((item) => {
            const selected = activeView === item;
            const label = item === 'connections' ? 'Connections' : 'Messages';
            return (
              <TouchableOpacity
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                aria-selected={selected}
                testID={`connections-view-${item}`}
                onPress={() => selectView(item)}
                style={[
                  styles.segment,
                  selected && { backgroundColor: colors.primary },
                ]}
              >
                <Feather
                  name={item === 'connections' ? 'users' : 'message-circle'}
                  size={15}
                  color={selected ? colors.primaryForeground : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.segmentLabel,
                    { color: selected ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          testID="connection-requests-link"
          onPress={() => router.push('/networking/requests' as any)}
          style={[styles.requestsLink, { backgroundColor: colors.surface }]}
        >
          <View style={[styles.requestsIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="user-plus" size={16} color={colors.primary} />
          </View>
          <Text style={[styles.requestsLabel, { color: colors.textOnSurface }]}>
            Connection requests
          </Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForegroundLight} />
        </TouchableOpacity>

        {__DEV__ ? (
          <View style={[styles.samplePanel, { backgroundColor: colors.surface }]}>
            <View style={styles.samplePanelCopy}>
              <Text style={[styles.sampleEyebrow, { color: colors.primary }]}>DEVELOPMENT ONLY</Text>
              <Text style={[styles.sampleDescription, { color: colors.mutedForegroundLight }]}>
                Restore requests and conversations for the demo member.
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: restoreSamples.isPending }}
              testID="restore-networking-samples"
              onPress={restoreNetworkingSamples}
              disabled={restoreSamples.isPending}
              style={[styles.sampleButton, { backgroundColor: colors.secondary }]}
            >
              {restoreSamples.isPending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="rotate-ccw" size={15} color={colors.primary} />
              )}
              <Text style={[styles.sampleButtonText, { color: colors.primary }]}>
                {restoreSamples.isPending ? 'Restoring…' : 'Restore sample data'}
              </Text>
            </TouchableOpacity>
            {restoreFeedback ? (
              <Text
                accessibilityLiveRegion="polite"
                testID="networking-sample-restore-feedback"
                style={[styles.sampleFeedback, { color: colors.mutedForegroundLight }]}
              >
                {restoreFeedback}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <FlatList
        data={visibleConnections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: bottomInset }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={emptyState}
        renderItem={({ item }) => {
          const fullName = [item.member.firstName, item.member.lastName].filter(Boolean).join(' ');
          const preview =
            activeView === 'messages'
              ? item.lastMessage?.content ?? 'No messages yet — say hello.'
              : item.member.bio || item.member.industry || 'Accepted connection';
          return (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Open conversation with ${fullName}`}
              testID={`connection-${item.id}`}
              style={[styles.connectionCard, { backgroundColor: colors.surface }]}
              onPress={() =>
                router.push({
                  pathname: '/networking/connections/[id]' as any,
                  params: { id: item.id, name: item.member.firstName },
                })
              }
              activeOpacity={0.75}
            >
              <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.avatarText, { color: colors.primary }]}>
                  {item.member.firstName?.[0] ?? '?'}
                </Text>
              </View>
              <View style={styles.connectionContent}>
                <Text style={[styles.connectionName, { color: colors.textOnSurface }]}>
                  {fullName || 'Bluebird member'}
                </Text>
                <Text style={[styles.industry, { color: colors.mutedForegroundLight }]}>
                  {item.member.industry || 'Bluebird member'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.preview,
                    { color: item.lastMessage ? colors.textOnSurface : colors.mutedForegroundLight },
                  ]}
                >
                  {preview}
                </Text>
              </View>
              <View style={styles.openConversation}>
                <Text style={[styles.openConversationLabel, { color: colors.primary }]}>Message</Text>
                <Feather name="chevron-right" size={18} color={colors.primary} />
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 7 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 27, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: 15,
    padding: 4,
    marginTop: 10,
  },
  segment: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  segmentLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  requestsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  requestsIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  requestsLabel: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  samplePanel: { borderRadius: 14, padding: 12, marginTop: 4, gap: 9 },
  samplePanelCopy: { gap: 3 },
  sampleEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.8 },
  sampleDescription: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  sampleButton: { minHeight: 38, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'flex-start' },
  sampleButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  sampleFeedback: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  list: { paddingHorizontal: 16, paddingTop: 2, gap: 10, flexGrow: 1 },
  connectionCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  connectionContent: { flex: 1, gap: 2 },
  connectionName: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  industry: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  preview: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  openConversation: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  openConversationLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9, marginTop: 4 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});