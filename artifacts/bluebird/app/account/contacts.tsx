import React, { useState } from 'react';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import {
  ActionSheetIOS,
  Appearance,
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useReferralProgram } from '@/hooks/useReferralProgram';
import {
  applyContactPick,
  beginSmsInvitation,
  contactPhoneLines,
  finishShareSheet,
  finishSmsComposer,
  pickDeviceContact,
  searchSelectedContacts,
  shareInvitationPayload,
  type ContactPhoneNumber,
  type SelectedContact,
} from '@/lib/connectContacts';
import FamilyMembershipScreen from '../membership/family';

export default function ContactsScreen() {
  const { authMode } = useAuth();
  if (authMode === 'clerk') return <ConnectContactsScreen />;
  return <FamilyMembershipScreen />;
}

function ConnectContactsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, isLoading, refresh } = useReferralProgram();
  const [contacts, setContacts] = useState<SelectedContact[]>([]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<{ id: string; kind: 'sms' | 'share' } | null>(null);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const inviteUrl = state.status === 'loaded' ? state.snapshot.inviteUrl : null;
  const visibleContacts = searchSelectedContacts(contacts, query);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  };

  const connect = async () => {
    if (picking) return;
    setPicking(true);
    setNotice(null);
    try {
      const outcome = await pickDeviceContact({
        platform: Platform.OS,
        presentPicker: async () => {
          const { presentContactPickerAsync } = await import('expo-contacts/legacy');
          return presentContactPickerAsync();
        },
      });
      const next = applyContactPick(contacts, outcome);
      setContacts(next.contacts);
      setNotice(next.notice);
    } finally {
      setPicking(false);
    }
  };

  const removeContact = (id: string) => {
    setContacts((current) => current.filter((contact) => contact.id !== id));
  };

  const linkNotice = isLoading
    ? 'The invitation link is still loading.'
    : 'A verified invitation link is not available yet.';

  const invite = async (contact: SelectedContact) => {
    if (busy) return;
    setBusy({ id: contact.id, kind: 'sms' });
    setNotice(null);
    try {
      const outcome = await beginSmsInvitation({
        contact,
        inviteUrl,
        chooseNumber: choosePhoneNumber,
        sendSms: presentSmsComposer,
      });
      if (outcome.status === 'needs-link') {
        setNotice(linkNotice);
        return;
      }
      if (outcome.status === 'needs-phone') {
        setNotice('SMS invitations need a phone number. You can share the invitation another way.');
        return;
      }
      if (outcome.status === 'cancelled') return;
      setNotice(finishSmsComposer(contacts, outcome.result).notice);
    } catch {
      setNotice('The message composer could not be opened. You can share the invitation another way.');
    } finally {
      setBusy(null);
    }
  };

  const shareAnotherWay = async (contact: SelectedContact) => {
    if (busy) return;
    const payload = shareInvitationPayload(inviteUrl);
    if (!payload) {
      setNotice(linkNotice);
      return;
    }
    setBusy({ id: contact.id, kind: 'share' });
    setNotice(null);
    try {
      let action: string | undefined;
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: 'Bluebird', text: payload.message, url: payload.url });
        action = 'sharedAction';
      } else if (Platform.OS === 'web') {
        setNotice('Sharing is not available on this device.');
        return;
      } else {
        const result = await Share.share(
          Platform.OS === 'ios' ? { message: payload.message, url: payload.url } : { message: payload.message },
        );
        action = result.action;
      }
      setNotice(finishShareSheet(action).notice);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setNotice('The share sheet could not be opened.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="connect-contacts-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: topPad + 12,
          paddingBottom: insets.bottom + 28,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          onPress={goBack}
          style={[styles.backButton, { backgroundColor: colors.muted }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="connect-contacts-back"
        >
          <Feather name="chevron-left" size={22} color={colors.textOnSurface} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Connect Contacts</Text>
        <Text style={[styles.explanation, { color: colors.mutedForegroundLight }]}>
          Choose people yourself and invite them to Bluebird. Selected contacts stay on this iPhone and are not uploaded.
        </Text>
        <TouchableOpacity
          onPress={() => { void connect(); }}
          disabled={picking}
          style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: picking ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Connect Contacts"
          testID="connect-contacts-button"
        >
          {picking ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Connect Contacts</Text>
          )}
        </TouchableOpacity>
        {isLoading ? (
          <Text style={[styles.statusLine, { color: colors.mutedForegroundLight }]}>Checking your invitation link…</Text>
        ) : null}
        {state.status === 'error' ? (
          <View style={styles.linkRow}>
            <Text style={[styles.statusLine, { color: colors.mutedForegroundLight, flex: 1 }]}>
              A verified invitation link is not available yet.
            </Text>
            <TouchableOpacity onPress={refresh} accessibilityRole="button" testID="connect-contacts-refresh-link">
              <Text style={[styles.linkAction, { color: colors.primary }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {notice ? (
          <Text accessibilityRole="alert" style={[styles.notice, { color: colors.destructive }]} testID="connect-contacts-notice">
            {notice}
          </Text>
        ) : null}
        {contacts.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]} testID="connect-contacts-empty">
            <Text style={[styles.emptyTitle, { color: colors.textOnSurface }]}>No contacts selected</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForegroundLight }]}>
              Contact selection is optional. The iPhone picker shares only the person you choose.
            </Text>
          </View>
        ) : (
          <>
            <ThemedTextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search selected contacts"
              placeholderTextColor={colors.mutedForegroundLight}
              autoCorrect={false}
              autoCapitalize="words"
              clearButtonMode="while-editing"
              style={[styles.search, {
                color: colors.textOnSurface,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              }]}
              accessibilityLabel="Search selected contacts"
              testID="connect-contacts-search"
            />
            {visibleContacts.length === 0 ? (
              <Text style={[styles.statusLine, { color: colors.mutedForegroundLight }]} testID="connect-contacts-no-matches">
                No selected contacts match that search.
              </Text>
            ) : (
              <View style={[styles.list, { backgroundColor: colors.surface }]}>
                {visibleContacts.map((contact, index) => {
                  const phoneLines = contactPhoneLines(contact);
                  const actionsDisabled = !inviteUrl || busy !== null;
                  return (
                    <View key={contact.id}>
                      {index > 0 ? <View style={[styles.separator, { backgroundColor: colors.separator }]} /> : null}
                      <View style={styles.row}>
                        <View style={styles.rowCopy}>
                          <Text style={[styles.name, { color: colors.textOnSurface }]}>{contact.displayName}</Text>
                          {phoneLines.length > 0 ? phoneLines.map((line, lineIndex) => (
                            <Text
                              key={contact.phoneNumbers[lineIndex]?.id ?? `line-${lineIndex}`}
                              style={[styles.meta, { color: colors.mutedForegroundLight }]}
                            >
                              {line}
                            </Text>
                          )) : (
                            <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>
                              SMS invitations need a phone number.
                            </Text>
                          )}
                          <TouchableOpacity
                            onPress={() => { void shareAnotherWay(contact); }}
                            disabled={actionsDisabled}
                            accessibilityRole="button"
                            accessibilityLabel={`Share ${contact.displayName} another way`}
                            testID={`connect-contacts-share-${index}`}
                          >
                            <Text style={[styles.secondaryAction, {
                              color: colors.primary,
                              opacity: inviteUrl ? 1 : 0.4,
                            }]}>
                              Share Another Way
                            </Text>
                          </TouchableOpacity>
                        </View>
                        {phoneLines.length > 0 ? (
                          <TouchableOpacity
                            onPress={() => { void invite(contact); }}
                            disabled={actionsDisabled}
                            accessibilityRole="button"
                            accessibilityLabel={`Invite ${contact.displayName}`}
                            testID={`connect-contacts-invite-${index}`}
                          >
                            <Text style={[styles.rowAction, {
                              color: colors.primary,
                              opacity: inviteUrl ? 1 : 0.4,
                            }]}>
                              {busy?.id === contact.id && busy.kind === 'sms' ? 'Opening…' : 'Invite'}
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          onPress={() => removeContact(contact.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${contact.displayName}`}
                          testID={`connect-contacts-remove-${index}`}
                        >
                          <Text style={[styles.rowAction, { color: colors.mutedForegroundLight }]}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    lineHeight: 28,
    marginTop: 12,
  },
  explanation: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  statusLine: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  linkAction: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginTop: 12,
  },
  notice: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  emptyCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginTop: 16,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  search: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginTop: 16,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  list: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 12,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  row: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowCopy: { flex: 1 },
  name: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  meta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  rowAction: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  secondaryAction: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
});

function choosePhoneNumber(numbers: readonly ContactPhoneNumber[]): Promise<string | null> {
  if (Platform.OS !== 'ios') return Promise.resolve(null);
  const options = numbers.map((phone) => (
    phone.label ? `${phone.label} · ${phone.number}` : phone.number
  ));
  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Choose a phone number',
        options: [...options, 'Cancel'],
        cancelButtonIndex: options.length,
        userInterfaceStyle: Appearance.getColorScheme() === 'light' ? 'light' : 'dark',
      },
      (selectedIndex) => {
        if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= numbers.length) {
          resolve(null);
          return;
        }
        resolve(numbers[selectedIndex]?.number ?? null);
      },
    );
  });
}

async function presentSmsComposer(
  phoneNumber: string,
  message: string,
): Promise<string | null | undefined> {
  const sms = await import('expo-sms');
  const available = await sms.isAvailableAsync();
  if (!available) return 'unavailable';
  const response = await sms.sendSMSAsync([phoneNumber], message);
  return response.result;
}
