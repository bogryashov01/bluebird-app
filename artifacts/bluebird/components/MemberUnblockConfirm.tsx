import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { presentBlockedMemberUnblockConfirmation } from '@/lib/memberSafety';

export function MemberUnblockConfirm({
  visible,
  embedded = false,
  pending,
  failure,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  embedded?: boolean;
  pending: boolean;
  failure: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const dialog = (
    <View style={embedded ? styles.embedded : styles.modal}>
      <Pressable
        accessibilityLabel="Close"
        style={styles.backdrop}
        onPress={pending ? undefined : onCancel}
      />
      <View
        testID="blocked-member-confirm"
        style={[
          styles.card,
          {
            backgroundColor: colors.offWhite,
            borderColor: colors.border,
            paddingBottom: 20 + Math.max(insets.bottom, 16),
          },
        ]}
      >
        <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>Unblock member</Text>
        <Text style={[styles.lead, { color: colors.mutedForegroundLight }]} testID="blocked-member-confirm-copy">
          {presentBlockedMemberUnblockConfirmation()}
        </Text>
        {failure ? (
          <Text style={[styles.lead, { color: colors.textOnSurface }]}>{failure}</Text>
        ) : null}
        <View style={styles.actions}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={pending}
            testID="blocked-member-confirm-cancel"
            onPress={onCancel}
            style={[styles.outline, { borderColor: colors.primary, opacity: pending ? 0.55 : 1 }]}
          >
            <Text style={[styles.outlineLabel, { color: colors.primary }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={pending}
            testID="blocked-member-confirm-submit"
            onPress={onConfirm}
            style={[styles.filled, { backgroundColor: colors.primary, opacity: pending ? 0.55 : 1 }]}
          >
            {pending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.filledLabel, { color: colors.primaryForeground }]}>Unblock</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
  if (embedded) return dialog;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={pending ? undefined : onCancel}>
      {dialog}
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  embedded: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,17,40,0.45)' },
  card: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20, gap: 12 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 10 },
  filled: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  filledLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  outline: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  outlineLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
