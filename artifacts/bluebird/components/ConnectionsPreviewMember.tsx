import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { demoMember } from '@/lib/connectionsPreview';
import { useConnectionsPreview } from '@/lib/useConnectionsPreview';
import { ConnectionsPreviewChrome } from '@/components/ConnectionsPreviewChrome';

export function ConnectionsPreviewMember({ memberId }: { memberId: string }) {
  const colors = useColors();
  const preview = useConnectionsPreview();
  const directoryMember = demoMember(memberId);
  const card = preview.members.find((member) => member.id === memberId) ?? null;
  const member = card ?? directoryMember;
  return (
    <ConnectionsPreviewChrome title="Profile preview">
      <View style={styles.body} testID="connections-member-screen">
        {!member ? (
          <Text style={[styles.bodyText, { color: colors.textOnSurface }]}>That demo profile is not available.</Text>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.kicker, { color: colors.primary }]}>Demo profile</Text>
            <Text style={[styles.name, { color: colors.textOnSurface }]}>{member.displayName}</Text>
            <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>{member.headline}</Text>
            <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>Home airport {member.homeAirport}</Text>
            {card ? (
              <Text style={[styles.bodyText, { color: colors.textOnSurface }]} testID="connections-member-relationship">
                {card.relationship === 'connected'
                  ? 'Connected'
                  : card.relationship === 'outgoing'
                    ? 'Pending Request'
                    : card.relationship === 'incoming'
                      ? 'Incoming request'
                      : card.relationship === 'blocked'
                        ? 'Blocked on this device'
                        : 'Not connected'}
              </Text>
            ) : null}
            <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>
              This preview is stored on this device. It is not a Bluebird account.
            </Text>
          </View>
        )}
      </View>
    </ConnectionsPreviewChrome>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16 },
  card: { borderRadius: 18, padding: 16, gap: 6 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  bodyText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
});
