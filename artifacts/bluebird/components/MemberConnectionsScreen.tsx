import React from 'react';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MemberConversationList } from '@/components/MemberConversationList';
import { MemberInitialsAvatar, MemberProfileSheet } from '@/components/MemberProfileSheet';
import { useColors } from '@/hooks/useColors';
import { connectionMemberLabel, discoverConnectionQuery, type AcceptedConnection, type ConnectionRelationship } from '@/lib/memberConnections';
import { presentDiscoveredMember } from '@/lib/memberConnectPresentation';
import { isMemberMessagesIntegrationEnabled } from '@/lib/memberMessages';
import { useMemberConnections } from '@/lib/useMemberConnections';
import { useOpenAcceptedConversation } from '@/lib/useMemberMessages';

type ProfileSheet =
  | { kind: 'accepted'; id: number }
  | { kind: 'incoming'; id: number }
  | { kind: 'discovery' };

export function MemberConnectionsScreen({ showBack = false }: { showBack?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const connections = useMemberConnections();
  const messages = useOpenAcceptedConversation();
  const queryClient = useQueryClient();
  const refreshQueueRelationships = () => {
    void queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes('connection-queue-status'),
    });
  };
  const messagesEnabled = isMemberMessagesIntegrationEnabled();
  const [pane, setPane] = React.useState<'connections' | 'chats'>('connections');
  const [phone, setPhone] = React.useState('');
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [findOpen, setFindOpen] = React.useState(false);
  const [requestsOpen, setRequestsOpen] = React.useState(false);
  const [sheet, setSheet] = React.useState<ProfileSheet | null>(null);
  const topInset = Platform.OS === 'web' ? 20 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 96 : insets.bottom + 88;
  const wash = colors.scheme === 'dark' ? colors.background : colors.secondary;

  const names = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const connection of connections.accepted) {
      map.set(connection.member.userId, connectionMemberLabel(connection.member));
    }
    return map;
  }, [connections.accepted]);

  React.useEffect(() => {
    setPhone('');
    setPhoneError(null);
    setFindOpen(false);
    setRequestsOpen(false);
    setPane(connections.enabled ? 'connections' : messagesEnabled ? 'chats' : 'connections');
    setSheet(null);
  }, [connections.accountId, connections.enabled, messagesEnabled]);

  const accepted = sheet?.kind === 'accepted'
    ? connections.accepted.find((connection) => connection.id === sheet.id) ?? null
    : null;
  const incoming = sheet?.kind === 'incoming'
    ? connections.incoming.find((request) => request.id === sheet.id) ?? null
    : null;
  const discovery = sheet?.kind === 'discovery' && connections.discovery ? connections.discovery : null;
  const foundMember = connections.discovery ? connections.discovery : null;

  const openFind = () => {
    setPhoneError(null);
    connections.clearDiscovery();
    setFindOpen(true);
  };
  const searchByPhone = () => {
    const query = discoverConnectionQuery({ phoneE164: phone });
    if (!query.ok) {
      setPhoneError('Enter a phone number in international format, such as +15551234567.');
      return;
    }
    setPhoneError(null);
    void connections.discover({ phoneE164: phone });
  };
  const discoveredState = foundMember
    ? presentDiscoveredMember({
      userId: foundMember.userId,
      acceptedUserIds: connections.accepted.map((connection) => connection.member.userId),
      incomingRequesterIds: connections.incoming.map((request) => request.requester.userId),
    })
    : null;

  const openConversation = (userId: string) => {
    void messages.open(userId).then((result) => {
      if (result?.kind === 'loaded') {
        setSheet(null);
        router.push({
          pathname: '/messages/[conversationId]',
          params: { conversationId: String(result.data.conversation.id) },
        });
      }
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="member-connections-screen">
      <LinearGradient colors={[wash, colors.offWhite]} locations={[0, 0.55]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        {showBack ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
            <Feather name="chevron-left" size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Connect</Text>
          {connections.enabled && connections.status !== 'signed-out' && connections.status !== 'disabled' ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Find a member"
              testID="member-connections-compose"
              onPress={() => { setPane('connections'); openFind(); }}
              style={[styles.compose, { backgroundColor: colors.primary }]}
            >
              <Feather name="edit-2" size={18} color={colors.primaryForeground} />
            </TouchableOpacity>
          ) : null}
        </View>
        {messagesEnabled || connections.enabled ? (
          <View accessibilityRole="tablist" style={styles.tabs}>
            {([
              ...(messagesEnabled ? (['chats'] as const) : []),
              ...(connections.enabled ? (['connections'] as const) : []),
            ] as const).map((item) => {
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
                  <View style={styles.tabLabelRow}>
                    <Feather
                      name={item === 'chats' ? 'message-circle' : 'users'}
                      size={16}
                      color={selected ? colors.textOnSurface : colors.mutedForegroundLight}
                    />
                    <Text style={[styles.tabLabel, { color: selected ? colors.textOnSurface : colors.mutedForegroundLight }]}>{label}</Text>
                  </View>
                  <View style={[styles.underline, { backgroundColor: selected ? colors.primary : 'transparent' }]} />
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>
      {pane === 'chats' && messagesEnabled ? (
          <MemberConversationList names={names} active={pane === 'chats'} bottomInset={bottomInset} />
      ) : connections.status === 'disabled' || !connections.enabled ? (
        <View style={styles.state} testID="member-connections-unavailable">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Connections are not available yet</Text>
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
            Try again later.
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
          style={{ backgroundColor: colors.offWhite }}
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={(
            <RefreshControl
              refreshing={connections.refreshing}
              onRefresh={() => { void connections.refresh(); }}
              tintColor={colors.primary}
              progressBackgroundColor={colors.surface}
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
          <View style={styles.actionRow}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Find Member"
              testID="member-connections-find"
              onPress={openFind}
              style={[styles.actionCard, { backgroundColor: colors.surface }]}
            >
              <Feather name="search" size={18} color={colors.primary} />
              <Text style={[styles.actionLabel, { color: colors.textOnSurface }]}>Find Member</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={connections.incoming.length > 0 ? `Incoming Requests, ${connections.incoming.length}` : 'Incoming Requests'}
              testID="member-connections-requests"
              onPress={() => setRequestsOpen(true)}
              style={[styles.actionCard, { backgroundColor: colors.surface }]}
            >
              <Feather name="inbox" size={18} color={colors.primary} />
              <Text style={[styles.actionLabel, { color: colors.textOnSurface }]}>Incoming Requests</Text>
              {connections.incoming.length > 0 ? (
                <View style={[styles.badge, { backgroundColor: colors.primary }]} testID="member-connections-requests-badge">
                  <Text style={[styles.badgeLabel, { color: colors.primaryForeground }]}>{connections.incoming.length}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
          <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>My Connections</Text>
          {connections.accepted.length === 0 ? (
            <View style={styles.emptyCopy} testID="member-connections-empty">
              <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>No Connections Yet</Text>
              <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>People you connect with will appear here.</Text>
            </View>
          ) : connections.accepted.map((connection) => (
            <AcceptedRow
              key={connection.id}
              connection={connection}
              colors={colors}
              onPress={() => setSheet({ kind: 'accepted', id: connection.id })}
            />
          ))}
        </ScrollView>
      )}
      <MemberProfileSheet
        visible={accepted !== null || incoming !== null || discovery !== null}
        name={
          accepted
            ? connectionMemberLabel(accepted.member)
            : incoming
              ? connectionMemberLabel(incoming.requester)
              : discovery
                ? connectionMemberLabel(discovery)
                : ''
        }
        lines={sheetLines(accepted, incoming, discovery)}
        primary={sheetPrimary({
          accepted,
          incoming,
          discovery,
          messagesEnabled: messages.enabled,
          pending: connections.pending || messages.opening,
          onMessage: () => { if (accepted) openConversation(accepted.member.userId); },
          onAccept: () => {
            if (!incoming) return;
            const requesterId = incoming.requester.userId;
            setSheet(null);
            void connections.accept(incoming.id).then((accepted) => {
              if (!accepted) return;
              refreshQueueRelationships();
              openConversation(requesterId);
            });
          },
          onConnect: () => {
            if (!discovery || discoveredState !== 'available') return;
            void connections.sendRequest(discovery).then((sent) => {
              if (!sent) return;
              setSheet(null);
              setFindOpen(false);
              setPhone('');
            });
          },
        })}
        secondary={incoming ? {
          label: 'Decline',
          testID: `member-connections-sheet-decline-${incoming.id}`,
          disabled: connections.pending,
          onPress: () => {
            setSheet(null);
            void connections.decline(incoming.id).then((declined) => {
              if (declined) refreshQueueRelationships();
            });
          },
        } : null}
        footnote={accepted ? {
          label: 'Remove',
          testID: `member-connections-remove-${accepted.id}`,
          disabled: connections.pending,
          onPress: () => { setSheet(null); void connections.remove(accepted.id); },
        } : null}
        onClose={() => setSheet(null)}
      />
      <Modal visible={findOpen} animationType="fade" transparent onRequestClose={() => setFindOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modal}>
          <Pressable accessibilityLabel="Close find member" style={styles.backdrop} onPress={() => setFindOpen(false)} />
          <View testID="member-connections-find-sheet" style={[styles.dialog, { backgroundColor: colors.offWhite, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.textOnSurface }]}>Find Member</Text>
            <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>Search by phone number.</Text>
            <ThemedTextInput
              value={phone}
              onChangeText={(value) => { setPhone(value); setPhoneError(null); }}
              autoCorrect={false}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              placeholder="+15551234567"
              placeholderTextColor={colors.mutedForegroundLight}
              testID="member-connections-phone"
              style={[styles.search, { color: colors.textOnSurface, backgroundColor: colors.surface }]}
            />
            {phoneError ? <Text style={[styles.meta, { color: colors.textOnSurface }]} testID="member-connections-phone-error">{phoneError}</Text> : null}
            <TouchableOpacity
              accessibilityRole="button"
              disabled={connections.pending}
              testID="member-connections-discover"
              onPress={searchByPhone}
              style={[styles.primary, { backgroundColor: colors.primary, opacity: connections.pending ? 0.55 : 1 }]}
            >
              {connections.pending ? <ActivityIndicator color={colors.primaryForeground} /> : (
                <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Search</Text>
              )}
            </TouchableOpacity>
            {connections.discovery === null ? (
              <Text style={[styles.meta, { color: colors.mutedForegroundLight }]} testID="member-connections-no-match">No member matched that phone number.</Text>
            ) : null}
            {foundMember ? (
              <View testID="member-connections-match" style={[styles.matchRow, { backgroundColor: colors.surface }]}>
                <MemberInitialsAvatar name={connectionMemberLabel(foundMember)} />
                <View style={styles.rowCopy}>
                  <Text style={[styles.name, { color: colors.textOnSurface }]}>{connectionMemberLabel(foundMember)}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>
                    {discoveredState === 'connected'
                      ? 'Already connected'
                      : discoveredState === 'incoming'
                        ? 'This member already sent you a request'
                        : 'Bluebird member'}
                  </Text>
                </View>
              </View>
            ) : null}
            {foundMember && discoveredState === 'available' ? (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={connections.pending}
                testID="member-connections-request"
                onPress={() => {
                  void connections.sendRequest(foundMember).then((sent) => {
                    if (!sent) return;
                    setFindOpen(false);
                    setPhone('');
                    setPhoneError(null);
                  });
                }}
                style={[styles.primary, { backgroundColor: colors.primary, opacity: connections.pending ? 0.55 : 1 }]}
              >
                <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Send request</Text>
              </TouchableOpacity>
            ) : null}
            {foundMember && discoveredState === 'incoming' ? (
              <TouchableOpacity
                accessibilityRole="button"
                testID="member-connections-open-requests"
                onPress={() => { setFindOpen(false); setRequestsOpen(true); }}
                style={[styles.primary, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>View request</Text>
              </TouchableOpacity>
            ) : null}
            {connections.message && connections.status !== 'error' ? (
              <Text style={[styles.meta, { color: colors.textOnSurface }]}>{connections.message}</Text>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={requestsOpen} animationType="fade" transparent onRequestClose={() => setRequestsOpen(false)}>
        <View style={styles.modal}>
          <Pressable accessibilityLabel="Close incoming requests" style={styles.backdrop} onPress={() => setRequestsOpen(false)} />
          <View testID="member-connections-requests-sheet" style={[styles.dialog, { backgroundColor: colors.offWhite, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.textOnSurface }]}>Incoming Requests</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.dialogScroll}>
              {connections.incoming.length === 0 ? (
                <Text style={[styles.meta, { color: colors.mutedForegroundLight }]} testID="member-connections-incoming-empty">
                  No incoming requests.
                </Text>
              ) : connections.incoming.map((request) => (
                <IncomingRequest
                  key={request.id}
                  request={request}
                  colors={colors}
                  pending={connections.pending}
                  onOpen={() => setSheet({ kind: 'incoming', id: request.id })}
                  onAccept={() => {
                    void connections.accept(request.id).then((accepted) => {
                      if (accepted) refreshQueueRelationships();
                    });
                  }}
                  onDecline={() => {
                    void connections.decline(request.id).then((declined) => {
                      if (declined) refreshQueueRelationships();
                    });
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function sheetLines(
  accepted: AcceptedConnection | null,
  incoming: ConnectionRelationship | null,
  discovery: { userId: string } | null,
): string[] {
  if (accepted) return ['Bluebird member', 'Connected'];
  if (incoming) return ['Bluebird member', 'Incoming request'];
  if (discovery) return ['Bluebird member', 'Not connected'];
  return [];
}

function sheetPrimary(input: {
  accepted: AcceptedConnection | null;
  incoming: ConnectionRelationship | null;
  discovery: { userId: string } | null;
  messagesEnabled: boolean;
  pending: boolean;
  onMessage: () => void;
  onAccept: () => void;
  onConnect: () => void;
}) {
  if (input.accepted && input.messagesEnabled) {
    return {
      label: 'Message',
      testID: `member-connections-message-${input.accepted.id}`,
      disabled: input.pending,
      onPress: input.onMessage,
    };
  }
  if (input.incoming) {
    return {
      label: 'Accept',
      testID: `member-connections-sheet-accept-${input.incoming.id}`,
      disabled: input.pending,
      onPress: input.onAccept,
    };
  }
  if (input.discovery) {
    return {
      label: 'Connect',
      testID: 'member-connections-request',
      disabled: input.pending,
      onPress: input.onConnect,
    };
  }
  return null;
}

function IncomingRequest({
  request,
  colors,
  pending,
  onOpen,
  onAccept,
  onDecline,
}: {
  request: ConnectionRelationship;
  colors: ReturnType<typeof useColors>;
  pending: boolean;
  onOpen: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const label = connectionMemberLabel(request.requester);
  return (
    <View style={[styles.requestRow, { borderBottomColor: colors.separator }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open request from ${label}`}
        testID={`member-connections-incoming-${request.id}`}
        onPress={onOpen}
        style={styles.requestIdentity}
      >
        <MemberInitialsAvatar name={label} />
        <View style={styles.rowCopy}>
          <Text style={[styles.name, { color: colors.textOnSurface }]}>{label}</Text>
          <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>Incoming request</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.requestActions}>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={pending}
          testID={`member-connections-accept-${request.id}`}
          onPress={onAccept}
          style={[styles.requestButton, { backgroundColor: colors.primary, opacity: pending ? 0.55 : 1 }]}
        >
          <Text style={[styles.requestButtonLabel, { color: colors.primaryForeground }]}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={pending}
          testID={`member-connections-decline-${request.id}`}
          onPress={onDecline}
          style={[styles.requestButton, { backgroundColor: colors.surface, opacity: pending ? 0.55 : 1 }]}
        >
          <Text style={[styles.requestButtonLabel, { color: colors.textOnSurface }]}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AcceptedRow({
  connection,
  colors,
  onPress,
}: {
  connection: AcceptedConnection;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const label = connectionMemberLabel(connection.member);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Open profile for ${label}`}
      testID={`member-connections-accepted-${connection.id}`}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: colors.separator }]}
    >
      <MemberInitialsAvatar name={label} />
      <View style={styles.rowCopy}>
        <Text style={[styles.name, { color: colors.textOnSurface }]}>{label}</Text>
        <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>Tap to view</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForegroundLight} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, gap: 4 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 40, letterSpacing: -1 },
  compose: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', marginTop: 8 },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  underline: { height: 2, alignSelf: 'stretch', borderRadius: 2 },
  emptyCopy: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 28, gap: 6 },
  list: { paddingTop: 8, gap: 8 },
  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  actionCard: { position: 'relative', flex: 1, minHeight: 74, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', gap: 8 },
  matchRow: { minHeight: 64, borderRadius: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  badge: { position: 'absolute', top: 10, right: 10, minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeLabel: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  modal: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '78%',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    gap: 12,
    overflow: 'hidden',
  },
  dialogScroll: { maxHeight: 320 },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  requestRow: { paddingVertical: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  requestIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  requestActions: { flexDirection: 'row', gap: 8 },
  requestButton: { minHeight: 40, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  requestButtonLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  feedback: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, paddingHorizontal: 20 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 18, marginBottom: 2, paddingHorizontal: 20 },
  entry: { marginHorizontal: 16, minHeight: 58, borderRadius: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  entryLabel: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  search: { borderRadius: 16, minHeight: 50, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 16 },
  row: { minHeight: 76, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, gap: 2 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  inset: { paddingHorizontal: 20 },
  primary: { minHeight: 50, borderRadius: 16, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
