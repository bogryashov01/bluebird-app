import React from 'react';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  CONNECTIONS_INVITE_WITHOUT_LINK,
  CONNECTIONS_MEMBERSHIP_UNVERIFIED,
  DEMO_CONVERSATION_NOTICE,
  formatPreviewTimestamp,
  matchDemoMemberByName,
  memberInitials,
  memberProfileAction,
  rememberConnectionsPane,
  type ConnectionsPane,
  type MemberCard,
} from '@/lib/connectionsPreview';
import { finishShareSheet, pickDeviceContact, type SelectedContact } from '@/lib/connectContacts';
import { useConnectionsPreview } from '@/lib/useConnectionsPreview';

export function ConnectionsHome({ showBack = false }: { showBack?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const preview = useConnectionsPreview();
  const [manual, setManual] = React.useState<{ accountId: string; pane: ConnectionsPane } | null>(null);
  const [finding, setFinding] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [contact, setContact] = React.useState<SelectedContact | null>(null);
  const [contactNotice, setContactNotice] = React.useState<string | null>(null);
  const [sheetMemberId, setSheetMemberId] = React.useState<string | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const pane = rememberConnectionsPane({
    accountId: preview.accountId,
    selectedAccountId: manual?.accountId ?? null,
    selectedPane: manual?.pane ?? null,
    ready: preview.status === 'ready',
    conversationCount: preview.conversations.length,
  });
  const topInset = Platform.OS === 'web' ? 20 : insets.top;
  const bottomInset = (Platform.OS === 'web' ? 96 : insets.bottom + 88);

  React.useEffect(() => {
    setFinding(false);
    setSearch('');
    setContact(null);
    setContactNotice(null);
    setSheetMemberId(null);
  }, [preview.accountId]);

  const selectPane = (next: ConnectionsPane) => {
    if (!preview.accountId || preview.status !== 'ready') return;
    setManual({ accountId: preview.accountId, pane: next });
  };

  const openChat = async (connectionId: string) => {
    const conversationId = await preview.openConversation(connectionId);
    if (!conversationId) return;
    setSheetMemberId(null);
    router.push({ pathname: '/connections-preview/chat/[id]', params: { id: conversationId } });
  };

  const findContacts = async () => {
    setContactNotice(null);
    const outcome = await pickDeviceContact({
      platform: Platform.OS,
      presentPicker: async () => {
        const { presentContactPickerAsync } = await import('expo-contacts/legacy');
        return presentContactPickerAsync();
      },
    });
    if (outcome.status === 'cancelled') return;
    if (outcome.status !== 'selected') {
      setContactNotice('Contacts are not available on this device.');
      return;
    }
    const matched = matchDemoMemberByName(outcome.contact.displayName);
    if (matched) {
      setContact(null);
      setSheetMemberId(matched.id);
      return;
    }
    setContact(outcome.contact);
  };

  const inviteContact = async () => {
    try {
      const result = await Share.share({ message: CONNECTIONS_INVITE_WITHOUT_LINK });
      const finished = finishShareSheet(result.action);
      if (finished.notice) setContactNotice(finished.notice);
    } catch {
      setContactNotice('The share sheet could not be opened.');
    }
  };

  const sheetMember = preview.members.find((member) => member.id === sheetMemberId) ?? null;

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="connections-home">
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        {showBack ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
            <Feather name="chevron-left" size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Connections</Text>
        <Text style={[styles.notice, { color: colors.mutedForegroundLight }]} testID="connections-preview-notice">
          {DEMO_CONVERSATION_NOTICE}
        </Text>
        <Text style={[styles.notice, { color: colors.mutedForegroundLight }]} testID="connections-membership-note">
          {CONNECTIONS_MEMBERSHIP_UNVERIFIED}
        </Text>
        <View accessibilityRole="tablist" style={[styles.tabs, { borderBottomColor: colors.border }]}>
          {(['chats', 'connections'] as const).map((item) => {
            const selected = pane === item;
            const label = item === 'chats' ? 'Chats' : 'Connections';
            return (
              <TouchableOpacity
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected, disabled: preview.status !== 'ready' }}
                testID={`connections-pane-${item}`}
                onPress={() => selectPane(item)}
                style={styles.tab}
              >
                <Text style={[styles.tabLabel, { color: selected ? colors.textOnSurface : colors.mutedForegroundLight }]}>
                  {label}
                  {item === 'chats' && preview.unreadCount > 0 ? ` (${preview.unreadCount})` : ''}
                </Text>
                <View style={[styles.underline, { backgroundColor: selected ? colors.primary : 'transparent' }]} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {preview.status === 'loading' ? (
        <View style={styles.state} testID="connections-preview-loading">
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>Loading Connections…</Text>
        </View>
      ) : null}
      {preview.status === 'signed-out' ? (
        <View style={styles.state} testID="connections-preview-signed-out">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Sign in to view Connections</Text>
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
            Demo connections stay on this device for the signed-in account.
          </Text>
        </View>
      ) : null}
      {preview.status === 'error' ? (
        <View style={styles.state} testID="connections-preview-error">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Connections are unavailable</Text>
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>
            {preview.actionMessage ?? 'Saved preview data could not be read on this device.'}
          </Text>
          <TouchableOpacity accessibilityRole="button" testID="connections-preview-retry" onPress={preview.refresh} style={[styles.outline, { borderColor: colors.border }]}>
            <Text style={[styles.outlineLabel, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {preview.status === 'ready' && pane ? (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
          {preview.actionMessage ? (
            <Text style={[styles.feedback, { color: colors.textOnSurface }]} testID="connections-preview-feedback">{preview.actionMessage}</Text>
          ) : null}
          {pane === 'chats' ? (
            preview.conversations.length === 0 ? (
              <Empty title="No conversations yet" body="Accepted demo connections can be messaged from Connections." testID="connections-preview-empty" colors={colors} />
            ) : preview.conversations.map((conversation) => (
              <TouchableOpacity
                key={conversation.id}
                accessibilityRole="button"
                accessibilityLabel={`Open conversation with ${conversation.member.displayName}`}
                testID={`connections-conversation-${conversation.id}`}
                onPress={() => router.push({ pathname: '/connections-preview/chat/[id]', params: { id: conversation.id } })}
                style={[styles.row, { borderBottomColor: colors.border }]}
              >
                <Avatar name={conversation.member.displayName} colors={colors} />
                <View style={styles.rowCopy}>
                  <Text style={[styles.name, { color: colors.textOnSurface }]}>{conversation.member.displayName}</Text>
                  <Text numberOfLines={1} style={[styles.meta, { color: colors.mutedForegroundLight }]}>{conversation.preview}</Text>
                </View>
                <View style={styles.rowEnd}>
                  <Text style={[styles.time, { color: colors.mutedForegroundLight }]}>
                    {formatPreviewTimestamp(conversation.activityAt, nowMs)}
                  </Text>
                  {conversation.unreadCount > 0 ? (
                    <Text testID={`connections-unread-${conversation.id}`} style={[styles.badge, { backgroundColor: colors.primary, color: colors.primaryForeground }]}>
                      {conversation.unreadCount}
                    </Text>
                  ) : <View style={styles.badgeSpacer} />}
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForegroundLight} />
              </TouchableOpacity>
            ))
          ) : (
            <>
              <TouchableOpacity accessibilityRole="button" testID="connections-find-members" onPress={() => { setFinding(true); setNowMs(Date.now()); }} style={[styles.entry, { backgroundColor: colors.surface }]}>
                <Text style={[styles.entryLabel, { color: colors.textOnSurface }]}>Find Members</Text>
                <Feather name="chevron-right" size={18} color={colors.mutedForegroundLight} />
              </TouchableOpacity>
              {finding ? (
                <>
                  <ThemedTextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search demo profiles by name"
                    placeholderTextColor={colors.mutedForegroundLight}
                    autoCapitalize="words"
                    autoCorrect={false}
                    testID="connections-search"
                    style={[styles.search, { color: colors.textOnSurface, backgroundColor: colors.surface }]}
                  />
                  {preview.members.filter((member) => member.displayName.toLowerCase().includes(search.trim().toLowerCase())).length === 0 ? (
                    <Empty title="No demo profiles match that name." body="" testID="connections-preview-empty" colors={colors} />
                  ) : preview.members.filter((member) => member.displayName.toLowerCase().includes(search.trim().toLowerCase())).map((member) => (
                    <MemberLine key={member.id} member={member} colors={colors} onPress={() => setSheetMemberId(member.id)} />
                  ))}
                </>
              ) : null}
              <TouchableOpacity accessibilityRole="button" testID="connections-find-contacts" onPress={() => void findContacts()} style={[styles.entry, { backgroundColor: colors.surface }]}>
                <Text style={[styles.entryLabel, { color: colors.textOnSurface }]}>Find Contacts</Text>
                <Feather name="chevron-right" size={18} color={colors.mutedForegroundLight} />
              </TouchableOpacity>
              {contact ? (
                <View style={[styles.card, { backgroundColor: colors.surface }]} testID="connections-contact-invite">
                  <Text style={[styles.name, { color: colors.textOnSurface }]}>{contact.displayName}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>Not in this demo directory</Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Invite to Bluebird" testID="connections-invite" onPress={() => void inviteContact()} style={[styles.primary, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Invite to Bluebird</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {contactNotice ? <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{contactNotice}</Text> : null}
              <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Connection requests</Text>
              <Text style={[styles.subsection, { color: colors.textOnSurface }]}>Incoming requests</Text>
              {preview.requests.incoming.length === 0 ? (
                <Text style={[styles.meta, { color: colors.mutedForegroundLight }]} testID="connections-incoming-empty">No incoming requests.</Text>
              ) : preview.requests.incoming.map((request) => (
                <View key={request.id} style={[styles.card, { backgroundColor: colors.surface }]} testID={`connections-incoming-${request.id}`}>
                  <Text style={[styles.name, { color: colors.textOnSurface }]}>{request.member.displayName}</Text>
                  <Text style={[styles.meta, { color: colors.primary }]}>Demo profile</Text>
                  <View style={styles.actions}>
                    <TouchableOpacity accessibilityRole="button" testID={`connections-accept-${request.id}`} onPress={() => void preview.acceptRequest(request.id)} style={[styles.primary, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" testID={`connections-decline-${request.id}`} onPress={() => void preview.declineRequest(request.id)} style={[styles.outline, { borderColor: colors.border }]}>
                      <Text style={[styles.outlineLabel, { color: colors.textOnSurface }]}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <Text style={[styles.subsection, { color: colors.textOnSurface }]}>Sent requests</Text>
              {preview.requests.outgoing.length === 0 ? (
                <Text style={[styles.meta, { color: colors.mutedForegroundLight }]} testID="connections-sent-empty">No sent requests.</Text>
              ) : preview.requests.outgoing.map((request) => (
                <View key={request.id} style={[styles.card, { backgroundColor: colors.surface }]} testID={`connections-sent-${request.id}`}>
                  <Text style={[styles.name, { color: colors.textOnSurface }]}>{request.member.displayName}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>Pending</Text>
                  <TouchableOpacity accessibilityRole="button" testID={`connections-request-cancel-${request.member.id}`} onPress={() => void preview.cancelRequest(request.id)}>
                    <Text style={[styles.link, { color: colors.primary }]}>Cancel request</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>My connections</Text>
              {preview.connections.length === 0 ? (
                <Empty title="No accepted demo connections on this device." body="" testID="connections-preview-empty" colors={colors} />
              ) : preview.connections.map((connection) => (
                <TouchableOpacity
                  key={connection.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open profile for ${connection.member.displayName}`}
                  testID={`connections-connection-${connection.id}`}
                  onPress={() => setSheetMemberId(connection.member.id)}
                  style={[styles.row, { borderBottomColor: colors.border }]}
                >
                  <Avatar name={connection.member.displayName} colors={colors} />
                  <View style={styles.rowCopy}>
                    <Text style={[styles.name, { color: colors.textOnSurface }]}>{connection.member.displayName}</Text>
                    <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>Bluebird Member</Text>
                    <Text style={[styles.meta, { color: colors.primary }]}>Demo profile</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForegroundLight} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      ) : null}
      <MemberSheet
        member={sheetMember}
        colors={colors}
        onClose={() => setSheetMemberId(null)}
        onConnect={() => { if (sheetMember) void preview.sendRequest(sheetMember.id); }}
        onAccept={() => {
          const request = preview.requests.incoming.find((item) => item.member.id === sheetMember?.id);
          if (request) void preview.acceptRequest(request.id);
        }}
        onDecline={() => {
          const request = preview.requests.incoming.find((item) => item.member.id === sheetMember?.id);
          if (request) void preview.declineRequest(request.id);
        }}
        onMessage={() => {
          const connection = preview.connections.find((item) => item.member.id === sheetMember?.id);
          if (connection) void openChat(connection.id);
        }}
      />
    </View>
  );
}

function MemberLine({
  member,
  colors,
  onPress,
}: {
  member: MemberCard;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" testID={`connections-member-${member.id}`} onPress={onPress} style={[styles.row, { borderBottomColor: colors.border }]}>
      <Avatar name={member.displayName} colors={colors} />
      <View style={styles.rowCopy}>
        <Text style={[styles.name, { color: colors.textOnSurface }]}>{member.displayName}</Text>
        <Text style={[styles.meta, { color: colors.primary }]}>Demo profile</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForegroundLight} />
    </TouchableOpacity>
  );
}

function Avatar({ name, colors, large = false }: { name: string; colors: ReturnType<typeof useColors>; large?: boolean }) {
  const size = large ? 96 : 48;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.secondary }]}>
      <Text style={[large ? styles.avatarLarge : styles.avatarText, { color: colors.primary }]}>{memberInitials(name)}</Text>
    </View>
  );
}

function MemberSheet({
  member,
  colors,
  onClose,
  onConnect,
  onAccept,
  onDecline,
  onMessage,
}: {
  member: MemberCard | null;
  colors: ReturnType<typeof useColors>;
  onClose: () => void;
  onConnect: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onMessage: () => void;
}) {
  const action = member ? memberProfileAction(member.relationship) : null;
  return (
    <Modal visible={!!member} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close profile" />
      <View style={[styles.sheet, { backgroundColor: colors.offWhite }]} testID="connections-member-sheet">
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        {member && action ? (
          <>
            <Avatar name={member.displayName} colors={colors} large />
            <Text style={[styles.sheetName, { color: colors.textOnSurface }]}>{member.displayName}</Text>
            <Text style={[styles.meta, { color: colors.textOnSurface }]}>Bluebird Member</Text>
            <Text style={[styles.meta, { color: colors.primary }]}>Demo profile</Text>
            <Text style={[styles.meta, { color: colors.mutedForegroundLight }]} testID="connections-member-relationship">
              {action === 'connect' ? 'Not connected' : action === 'pending' ? 'Request pending' : action === 'incoming' ? 'Incoming request' : action === 'message' ? 'Connected' : 'Messaging unavailable'}
            </Text>
            <View style={styles.sheetActions}>
              {action === 'connect' ? (
                <TouchableOpacity accessibilityRole="button" testID="connections-profile-connect" onPress={onConnect} style={[styles.primary, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Connect</Text>
                </TouchableOpacity>
              ) : null}
              {action === 'pending' ? (
                <View testID="connections-profile-pending" style={[styles.primary, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.primaryLabel, { color: colors.mutedForegroundLight }]}>Request Pending</Text>
                </View>
              ) : null}
              {action === 'incoming' ? (
                <>
                  <TouchableOpacity accessibilityRole="button" testID="connections-profile-accept" onPress={onAccept} style={[styles.primary, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" testID="connections-profile-decline" onPress={onDecline} style={[styles.outline, { borderColor: colors.border }]}>
                    <Text style={[styles.outlineLabel, { color: colors.textOnSurface }]}>Decline</Text>
                  </TouchableOpacity>
                </>
              ) : null}
              {action === 'message' ? (
                <TouchableOpacity accessibilityRole="button" testID="connections-profile-message" onPress={onMessage} style={[styles.primary, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Message</Text>
                </TouchableOpacity>
              ) : null}
              {action === 'unavailable' ? (
                <View testID="connections-profile-unavailable" style={[styles.primary, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.primaryLabel, { color: colors.mutedForegroundLight }]}>Messaging unavailable</Text>
                </View>
              ) : null}
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <Text style={[styles.link, { color: colors.primary }]}>Close</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
      </View>
    </Modal>
  );
}

function Empty({
  title,
  body,
  testID,
  colors,
}: {
  title: string;
  body: string;
  testID: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.state} testID={testID}>
      <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>{title}</Text>
      {body ? <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, gap: 6 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: -0.6 },
  notice: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  tabs: { flexDirection: 'row', marginTop: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  tabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  underline: { height: 2, alignSelf: 'stretch', borderRadius: 2 },
  list: { paddingTop: 8 },
  feedback: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingBottom: 8 },
  entry: { minHeight: 56, marginHorizontal: 16, marginTop: 12, borderRadius: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entryLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  search: { marginHorizontal: 16, marginTop: 10, borderRadius: 14, minHeight: 48, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 16 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 22, marginBottom: 6, paddingHorizontal: 20 },
  subsection: { fontFamily: 'Inter_600SemiBold', fontSize: 15, paddingHorizontal: 20, marginTop: 8, marginBottom: 4 },
  row: { minHeight: 76, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, gap: 2 },
  rowEnd: { alignItems: 'flex-end', gap: 6 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  time: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  badge: { minWidth: 22, overflow: 'hidden', borderRadius: 11, textAlign: 'center', fontFamily: 'Inter_700Bold', fontSize: 12, paddingHorizontal: 6, paddingVertical: 2 },
  badgeSpacer: { height: 18 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  avatarLarge: { fontFamily: 'Inter_700Bold', fontSize: 32 },
  card: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, padding: 14, gap: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  primary: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  outline: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  outlineLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 36, alignItems: 'center', gap: 6 },
  handle: { width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  sheetName: { fontFamily: 'Inter_700Bold', fontSize: 28, textAlign: 'center', marginTop: 8 },
  close: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
});
