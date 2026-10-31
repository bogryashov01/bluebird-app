import React from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { connectionMemberLabel } from '@/lib/memberConnections';
import { isMemberMessagesIntegrationEnabled } from '@/lib/memberMessages';
import { useMemberConnections } from '@/lib/useMemberConnections';
import { useOpenAcceptedConversation } from '@/lib/useMemberMessages';
import { MemberConversationList } from '@/components/MemberConversationList';

export function MemberConnectionsScreen({ showBack = false }: { showBack?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const connections = useMemberConnections();
  const messages = useOpenAcceptedConversation();
  const messagesEnabled = isMemberMessagesIntegrationEnabled();
  const [pane, setPane] = React.useState<'connections' | 'chats'>('connections');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const topInset = Platform.OS === 'web' ? 20 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 96 : insets.bottom + 88;

  const names = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const connection of connections.accepted) {
      map.set(connection.member.userId, connectionMemberLabel(connection.member));
    }
    return map;
  }, [connections.accepted]);

  React.useEffect(() => {
    setEmail('');
    setPhone('');
    setPane('connections');
  }, [connections.accountId, connections.enabled]);

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="member-connections-screen">
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        {showBack ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
            <Feather name="chevron-left" size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Connections</Text>
        <View accessibilityRole="tablist" style={[styles.tabs, { borderBottomColor: colors.border }]}>
          {(['chats', 'connections'] as const).map((item) => {
            const selected = pane === item;
            const label = item === 'chats' ? 'Chats' : 'Connections';
            return (
              <TouchableOpacity
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                testID={`member-connections-pane-${item}`}
                onPress={() => setPane(item)}
                style={styles.tab}
              >
                <Text style={[styles.tabLabel, { color: selected ? colors.textOnSurface : colors.mutedForegroundLight }]}>{label}</Text>
                <View style={[styles.underline, { backgroundColor: selected ? colors.primary : 'transparent' }]} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {pane === 'chats' ? (
        messagesEnabled ? (
          <MemberConversationList names={names} active={pane === 'chats'} />
        ) : (
          <View style={styles.state} testID="member-connections-messages-unavailable">
            <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Messages are not available yet</Text>
            <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
              Private messages stay off until that service is ready.
            </Text>
          </View>
        )
      ) : connections.status === 'disabled' ? (
        <View style={styles.state} testID="member-connections-unavailable">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Connections are not available yet</Text>
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
            Member discovery and connection requests stay off until the service is deployed.
          </Text>
        </View>
      ) : connections.status === 'signed-out' ? (
        <View style={styles.state} testID="member-connections-signed-out">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Sign in to view Connections</Text>
        </View>
      ) : connections.status === 'loading' && connections.incoming.length === 0 && connections.accepted.length === 0 ? (
        <View style={styles.state} testID="member-connections-loading">
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>Loading Connections…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={(
            <RefreshControl
              refreshing={connections.refreshing}
              onRefresh={() => { void connections.refresh(); }}
              tintColor={colors.primary}
            />
          )}
        >
          {connections.status === 'error' ? (
            <View style={styles.state} testID="member-connections-error">
              <Text style={[styles.stateBody, { color: colors.textOnSurface }]}>{connections.message}</Text>
              <TouchableOpacity accessibilityRole="button" testID="member-connections-retry" onPress={() => { void connections.refresh(); }}>
                <Text style={[styles.link, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {messages.message ? (
            <Text style={[styles.feedback, { color: colors.textOnSurface }]} testID="member-messages-open-feedback">{messages.message}</Text>
          ) : null}
          {connections.message && connections.status !== 'error' ? (
            <Text style={[styles.feedback, { color: colors.textOnSurface }]} testID="member-connections-feedback">{connections.message}</Text>
          ) : null}
          <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Find a member</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="Exact email address"
            placeholderTextColor={colors.mutedForegroundLight}
            testID="member-connections-email"
            style={[styles.search, { color: colors.textOnSurface, backgroundColor: colors.surface }]}
          />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            autoCorrect={false}
            keyboardType="phone-pad"
            placeholder="Exact phone, +15551234567"
            placeholderTextColor={colors.mutedForegroundLight}
            testID="member-connections-phone"
            style={[styles.search, { color: colors.textOnSurface, backgroundColor: colors.surface }]}
          />
          <TouchableOpacity
            accessibilityRole="button"
            disabled={connections.pending}
            testID="member-connections-discover"
            onPress={() => { void connections.discover({ email, phoneE164: phone }); }}
            style={[styles.primary, { backgroundColor: colors.primary, opacity: connections.pending ? 0.55 : 1 }]}
          >
            <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Find member</Text>
          </TouchableOpacity>
          {connections.discovery ? (
            <View style={[styles.card, { backgroundColor: colors.surface }]} testID="member-connections-match">
              <Text style={[styles.name, { color: colors.textOnSurface }]}>{connectionMemberLabel(connections.discovery)}</Text>
              <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>Bluebird member</Text>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={connections.pending}
                testID="member-connections-request"
                onPress={() => { if (connections.discovery) void connections.sendRequest(connections.discovery); }}
                style={[styles.cardButton, { backgroundColor: colors.primary, opacity: connections.pending ? 0.55 : 1 }]}
              >
                <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Connect</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Incoming requests</Text>
          {connections.incoming.length === 0 ? (
            <Text style={[styles.meta, styles.inset, { color: colors.mutedForegroundLight }]} testID="member-connections-incoming-empty">No incoming requests.</Text>
          ) : connections.incoming.map((request) => (
            <View key={request.id} style={[styles.card, { backgroundColor: colors.surface }]} testID={`member-connections-incoming-${request.id}`}>
              <Text style={[styles.name, { color: colors.textOnSurface }]}>{connectionMemberLabel(request.requester)}</Text>
              <View style={styles.actions}>
                <TouchableOpacity accessibilityRole="button" disabled={connections.pending} testID={`member-connections-accept-${request.id}`} onPress={() => { void connections.accept(request.id); }} style={[styles.cardButton, { backgroundColor: colors.primary, opacity: connections.pending ? 0.55 : 1 }]}>
                  <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" disabled={connections.pending} testID={`member-connections-decline-${request.id}`} onPress={() => { void connections.decline(request.id); }} style={[styles.outline, { borderColor: colors.border }]}>
                  <Text style={[styles.outlineLabel, { color: colors.textOnSurface }]}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>My connections</Text>
          {connections.accepted.length === 0 ? (
            <Text style={[styles.meta, styles.inset, { color: colors.mutedForegroundLight }]} testID="member-connections-empty">No accepted connections.</Text>
          ) : connections.accepted.map((connection) => (
            <View key={connection.id} style={[styles.row, { borderBottomColor: colors.border }]} testID={`member-connections-accepted-${connection.id}`}>
              <View style={styles.rowCopy}>
                <Text style={[styles.name, { color: colors.textOnSurface }]}>{connectionMemberLabel(connection.member)}</Text>
                <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>Bluebird member</Text>
              </View>
              <View style={styles.rowActions}>
                {messages.enabled ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={messages.opening || connections.pending}
                    testID={`member-connections-message-${connection.id}`}
                    onPress={() => {
                      void messages.open(connection.member.userId).then((result) => {
                        if (result?.kind === 'loaded') {
                          router.push({
                            pathname: '/messages/[conversationId]',
                            params: { conversationId: String(result.data.conversation.id) },
                          });
                        }
                      });
                    }}
                  >
                    <Text style={[styles.link, { color: colors.primary }]}>Message</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity accessibilityRole="button" disabled={connections.pending} testID={`member-connections-remove-${connection.id}`} onPress={() => { void connections.remove(connection.id); }}>
                  <Text style={[styles.link, { color: colors.primary }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, gap: 6 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: -0.6 },
  tabs: { flexDirection: 'row', marginTop: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  tabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  underline: { height: 2, alignSelf: 'stretch', borderRadius: 2 },
  list: { paddingTop: 8 },
  feedback: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingBottom: 8 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 22, marginBottom: 6, paddingHorizontal: 20 },
  search: { marginHorizontal: 16, marginTop: 10, borderRadius: 14, minHeight: 48, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 16 },
  card: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, padding: 14, gap: 6 },
  row: { minHeight: 72, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, gap: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  inset: { paddingHorizontal: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  primary: { minHeight: 48, borderRadius: 14, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  cardButton: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  outline: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  outlineLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
