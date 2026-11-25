import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MemberInitialsAvatar } from '@/components/MemberProfileSheet';
import { MemberUnblockConfirm } from '@/components/MemberUnblockConfirm';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  blockedMemberDisplayName,
  blockedMembersAfterUnblock,
  createMemberSafetyClient,
  isMemberSafetyEnabled,
  presentBlockedMembersEmpty,
  presentMemberSafetyFailure,
  publishMemberSafetyRefresh,
  type BlockedMember,
  type MemberSafetyFailure,
} from '@/lib/memberSafety';

export default function BlockedMembersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const enabled = isMemberSafetyEnabled();
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [blocks, setBlocks] = React.useState<BlockedMember[]>([]);
  const [failure, setFailure] = React.useState<MemberSafetyFailure | null>(null);
  const [confirmId, setConfirmId] = React.useState<number | null>(null);
  const [pendingId, setPendingId] = React.useState<number | null>(null);
  const pendingRef = React.useRef<number | null>(null);
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    const requested = generation.current + 1;
    generation.current = requested;
    if (!enabled) {
      setStatus('ready');
      setBlocks([]);
      return;
    }
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const getToken = sessionRef.current?.getToken;
    if (!configuration || sessionRef.current?.isSignedIn !== true || typeof getToken !== 'function') {
      if (generation.current !== requested) return;
      setStatus('error');
      setFailure('token');
      return;
    }
    setStatus('loading');
    setFailure(null);
    const client = createMemberSafetyClient({
      enabled: true,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      getAccessToken: () => sessionRef.current?.getToken() ?? Promise.resolve(null),
    });
    const result = await client.listBlocks();
    if (generation.current !== requested) return;
    if (result.kind === 'loaded') {
      setBlocks(result.data.blocks);
      setStatus('ready');
      return;
    }
    setStatus('error');
    setFailure(result.kind === 'disabled' ? 'configuration' : result.code);
  }, [enabled]);

  useFocusEffect(React.useCallback(() => {
    void load();
  }, [load]));

  const confirm = blocks.find((block) => block.id === confirmId) ?? null;

  const unblock = () => {
    if (confirmId === null || pendingRef.current !== null) return;
    const blockId = confirmId;
    pendingRef.current = blockId;
    setPendingId(blockId);
    setFailure(null);
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration) {
      pendingRef.current = null;
      setPendingId(null);
      setFailure('configuration');
      return;
    }
    const client = createMemberSafetyClient({
      enabled: true,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      getAccessToken: () => sessionRef.current?.getToken() ?? Promise.resolve(null),
    });
    void client.unblock(blockId).then((result) => {
      const succeeded = result.kind === 'loaded';
      setBlocks((current) => blockedMembersAfterUnblock(current, blockId, succeeded));
      if (succeeded) {
        publishMemberSafetyRefresh();
        setConfirmId(null);
        return;
      }
      setFailure(result.kind === 'disabled' ? 'configuration' : result.code);
    }).finally(() => {
      pendingRef.current = null;
      setPendingId(null);
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite, paddingTop: insets.top + 12 }]} testID="blocked-members-screen">
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Back to Profile"
        testID="blocked-members-back"
        onPress={() => router.back()}
        style={[styles.back, { backgroundColor: colors.surface }]}
      >
        <Feather name="chevron-left" size={23} color={colors.textOnSurface} />
      </TouchableOpacity>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Blocked Members</Text>
      <Text style={[styles.lead, { color: colors.mutedForegroundLight }]}>
        People you have blocked. Unblocking does not create a connection.
      </Text>
      {status === 'loading' ? (
        <View style={styles.state} testID="blocked-members-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : status === 'error' ? (
        <View style={styles.state} testID="blocked-members-error">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>
            {presentMemberSafetyFailure(failure ?? 'unavailable')}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            testID="blocked-members-retry"
            onPress={() => { void load(); }}
            style={[styles.filled, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.filledLabel, { color: colors.primaryForeground }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : blocks.length === 0 ? (
        <View style={styles.state} testID="blocked-members-empty">
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>{presentBlockedMembersEmpty()}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 10 }}>
          {blocks.map((block) => {
            const name = blockedMemberDisplayName(block);
            return (
              <View key={block.id} testID={`blocked-member-${block.id}`} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <MemberInitialsAvatar name={name} imageUrl={block.imageUrl} size={48} />
                <Text style={[styles.name, { color: colors.textOnSurface }]} numberOfLines={2}>{name}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${name}`}
                  testID={`blocked-member-unblock-${block.id}`}
                  disabled={pendingId !== null}
                  onPress={() => {
                    if (pendingRef.current !== null) return;
                    setConfirmId(block.id);
                  }}
                  style={[styles.unblock, { borderColor: colors.primary, opacity: pendingId !== null ? 0.55 : 1 }]}
                >
                  <Text style={[styles.unblockLabel, { color: colors.primary }]}>Unblock</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}
      <MemberUnblockConfirm
        visible={confirm !== null}
        pending={pendingId !== null}
        failure={failure && confirm ? presentMemberSafetyFailure(failure) : null}
        onCancel={() => { if (pendingId === null) setConfirmId(null); }}
        onConfirm={unblock}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 22 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.6 },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 16 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingBottom: 48 },
  stateTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, textAlign: 'center' },
  row: { minHeight: 72, borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 48, height: 48, borderRadius: 24 },
  name: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  unblock: { minHeight: 40, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  unblockLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  filled: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  filledLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
