import React from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateFamilyInvitation,
  useGetFamilyMembership,
  useUpdateFamilyMemberAllocation,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

function errorText(error: any, fallback: string) {
  return error?.response?.data?.error ?? error?.data?.error ?? fallback;
}

export default function FamilyMembershipScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [linkExisting, setLinkExisting] = React.useState(false);
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const familyQuery = useGetFamilyMembership({});
  const family = familyQuery.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/membership/family'] });
    queryClient.invalidateQueries({ queryKey: ['/api/membership'] });
  };
  const inviteMutation = useCreateFamilyInvitation({
    mutation: {
      onSuccess: (data) => {
        setEmail('');
        setNotice(data.status === 'linked'
          ? 'Account linked. Family Plus access is active.'
          : 'Invitation email sent. The recipient can use the link in their inbox.');
        setFormError(null);
        refresh();
      },
      onError: (error) => {
        setFormError(errorText(error, 'Could not update Family members.'));
        refresh();
      },
    },
  });
  const allocationMutation = useUpdateFamilyMemberAllocation({
    mutation: {
      onSuccess: () => {
        setNotice('Family pass allocation updated.');
        setFormError(null);
        refresh();
      },
      onError: (error) => setFormError(errorText(error, 'Could not update that allocation.')),
    },
  });

  if (familyQuery.isLoading) {
    return <View style={[styles.centered, { backgroundColor: colors.offWhite }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (familyQuery.isError || !family) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite, padding: 28 }]}>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Family membership unavailable</Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
          This account is not linked to a Family/Corporate plan, or the invitation is still waiting for acceptance.
        </Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={() => familyQuery.refetch()}>
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isOwner = family.role === 'primary';
  const linkedMembers = family.members.filter((member) => member.role !== 'primary' && member.status === 'active');
  const submitInvite = () => {
    setFormError(null);
    setNotice(null);
    inviteMutation.mutate({ data: { email: email.trim().toLowerCase(), linkExisting } });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Family/Corporate</Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
          {isOwner
            ? 'You are the primary holder. Manage up to three linked members and one shared pool of seven annual Skip the Line passes.'
            : 'You have Family Plus access. This view shows only your own linked membership and assigned passes.'}
        </Text>

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>Shared annual passes</Text>
          <Text style={[styles.poolValue, { color: colors.primary }]}>{family.pool.available} available</Text>
          <Text style={[styles.caption, { color: colors.mutedForegroundLight }]}>
            {family.pool.allocated} allocated · {family.pool.used} used · {family.pool.unallocated} unallocated
          </Text>
          <Text style={[styles.caption, { color: colors.mutedForegroundLight }]}>
            Unused passes expire at renewal. If the plan ends, linked members lose Family access.
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>
          {isOwner ? `Members (${family.members.filter((member) => member.status !== 'ended').length}/${family.memberLimit})` : 'Your Family membership'}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {family.members.map((member, index) => (
            <View key={member.id} style={[styles.memberRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.separator }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.memberName, { color: colors.textOnSurface }]}>
                  {member.name ?? member.email}{member.role === 'primary' ? ' · Primary holder' : ''}
                </Text>
                <Text style={[styles.caption, { color: colors.mutedForegroundLight }]}>{member.email}</Text>
                {member.status !== 'active' && (
                  <Text style={[styles.caption, { color: member.status === 'conflict' ? colors.destructive : colors.mutedForegroundLight }]}>
                    {member.status === 'conflict' ? 'Existing membership — staff review required' : `Status: ${member.status}`}
                  </Text>
                )}
                <Text style={[styles.passText, { color: colors.textOnSurface }]}>
                  {member.availablePasses} available · {member.usedPasses} used
                </Text>
              </View>
              {isOwner && member.role !== 'primary' && member.status === 'active' && (
                <View style={styles.allocation}>
                  <TouchableOpacity
                    style={[styles.stepper, { borderColor: colors.border }]}
                    disabled={member.allocatedPasses <= member.usedPasses || allocationMutation.isPending}
                    onPress={() => allocationMutation.mutate({
                      memberId: member.id,
                      data: { allocatedPasses: member.allocatedPasses - 1 },
                    })}
                  >
                    <Text style={[styles.stepperText, { color: colors.textOnSurface }]}>−</Text>
                  </TouchableOpacity>
                  <Text style={[styles.allocationValue, { color: colors.textOnSurface }]}>{member.allocatedPasses}</Text>
                  <TouchableOpacity
                    style={[styles.stepper, { borderColor: colors.border }]}
                    disabled={allocationMutation.isPending || family.pool.unallocated <= 0}
                    onPress={() => allocationMutation.mutate({
                      memberId: member.id,
                      data: { allocatedPasses: member.allocatedPasses + 1 },
                    })}
                  >
                    <Text style={[styles.stepperText, { color: colors.textOnSurface }]}>+</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
          {isOwner && family.pendingInvitations.map((invitation) => (
            <View key={invitation.id} style={[styles.pendingRow, { borderTopColor: colors.separator }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.memberName, { color: colors.textOnSurface }]}>{invitation.email}</Text>
                <Text style={[styles.caption, { color: invitation.deliveryStatus === 'failed' ? colors.destructive : colors.mutedForegroundLight }]}>
                  {invitation.deliveryStatus === 'failed'
                    ? `Email failed${invitation.deliveryError ? `: ${invitation.deliveryError}` : ''}`
                    : 'Invitation pending'}
                </Text>
              </View>
              <Text style={[styles.pendingText, { color: invitation.deliveryStatus === 'sent' ? colors.primary : colors.mutedForegroundLight }]}>
                {invitation.deliveryStatus === 'sent' ? 'Sent' : 'Waiting'}
              </Text>
            </View>
          ))}
        </View>

        {isOwner && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Add a member</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="member@example.com"
                placeholderTextColor={colors.mutedForegroundLight}
                style={[styles.input, { color: colors.textOnSurface, borderColor: colors.border }]}
              />
              <View style={styles.modeRow}>
                <TouchableOpacity onPress={() => setLinkExisting(false)} style={styles.modeOption}>
                  <Text style={[styles.modeText, { color: !linkExisting ? colors.primary : colors.mutedForegroundLight }]}>Send invitation</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setLinkExisting(true)} style={styles.modeOption}>
                  <Text style={[styles.modeText, { color: linkExisting ? colors.primary : colors.mutedForegroundLight }]}>Link existing account</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary, opacity: inviteMutation.isPending || !email.trim() ? 0.6 : 1 }]}
                disabled={inviteMutation.isPending || !email.trim()}
                onPress={submitInvite}
              >
                {inviteMutation.isPending
                  ? <ActivityIndicator color={colors.primaryForeground} />
                  : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{linkExisting ? 'Link account' : 'Create invitation'}</Text>}
              </TouchableOpacity>
              <Text style={[styles.caption, { color: colors.mutedForegroundLight }]}>
                Accounts with an existing individual membership stay pending for staff review and are never auto-linked.
              </Text>
            </View>
          </>
        )}
        {!!notice && <Text style={[styles.notice, { color: colors.primary }]}>{notice}</Text>}
        {!!formError && <Text style={[styles.notice, { color: colors.destructive }]}>{formError}</Text>}
        <TouchableOpacity onPress={() => router.push('/membership/manage' as any)} style={styles.manageLink}>
          <Text style={[styles.modeText, { color: colors.mutedForegroundLight }]}>Manage annual plan</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingTop: 20 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 },
  card: { borderRadius: 18, padding: 16, marginBottom: 20 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  poolValue: { fontFamily: 'Inter_700Bold', fontSize: 28, marginTop: 6 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingVertical: 12 },
  memberName: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  passText: { fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 6 },
  pendingText: { fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  allocation: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepper: { width: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepperText: { fontFamily: 'Inter_600SemiBold', fontSize: 18 },
  allocationValue: { fontFamily: 'Inter_700Bold', fontSize: 16, minWidth: 18, textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontFamily: 'Inter_400Regular', fontSize: 14 },
  modeRow: { flexDirection: 'row', gap: 16, paddingVertical: 12 },
  modeOption: { paddingVertical: 4 },
  modeText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  button: { borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  notice: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', marginBottom: 10 },
  manageLink: { alignItems: 'center', paddingVertical: 12 },
});