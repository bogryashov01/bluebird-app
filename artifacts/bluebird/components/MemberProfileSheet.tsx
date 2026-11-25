import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { memberInitials } from '@/lib/memberConnectPresentation';

export interface MemberProfileAction {
  label: string;
  testID: string;
  disabled?: boolean;
  onPress: () => void;
}

export function MemberInitialsAvatar({ name, size = 48 }: { name: string; size?: number }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.secondary,
        },
      ]}
    >
      <Text style={[size >= 80 ? styles.avatarLarge : styles.avatarText, { color: colors.primary }]}>
        {memberInitials(name)}
      </Text>
    </View>
  );
}

export function MemberProfileSheet({
  visible,
  name,
  lines,
  primary,
  secondary,
  footnote,
  extra,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  name: string;
  lines: readonly string[];
  primary?: MemberProfileAction | null;
  secondary?: MemberProfileAction | null;
  footnote?: MemberProfileAction | null;
  extra?: readonly MemberProfileAction[] | null;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={styles.modal}>
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} accessibilityLabel="Close profile" />
        <View
          style={[styles.sheet, { backgroundColor: colors.offWhite, paddingBottom: Math.max(insets.bottom, 16) }]}
          testID="member-profile-sheet"
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={[styles.avatarRing, { borderColor: colors.secondary }]}>
            <MemberInitialsAvatar name={name} size={96} />
          </View>
          <Text style={[styles.name, { color: colors.textOnSurface }]}>{name}</Text>
          {lines.map((line) => (
            <Text key={line} style={[styles.line, { color: colors.mutedForegroundLight }]}>{line}</Text>
          ))}
          {primary || secondary ? (
            <View style={styles.actions}>
              {primary ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={primary.disabled}
                  testID={primary.testID}
                  onPress={primary.onPress}
                  style={[styles.filled, { backgroundColor: colors.primary, opacity: primary.disabled ? 0.55 : 1 }]}
                >
                  <Text style={[styles.filledLabel, { color: colors.primaryForeground }]}>{primary.label}</Text>
                </TouchableOpacity>
              ) : null}
              {secondary ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={secondary.disabled}
                  testID={secondary.testID}
                  onPress={secondary.onPress}
                  style={[styles.outline, { borderColor: colors.primary, opacity: secondary.disabled ? 0.55 : 1 }]}
                >
                  <Text style={[styles.outlineLabel, { color: colors.primary }]}>{secondary.label}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {extra?.map((action) => (
            <TouchableOpacity
              key={action.testID}
              accessibilityRole="button"
              disabled={action.disabled}
              testID={action.testID}
              onPress={action.onPress}
              style={[styles.extra, { borderColor: colors.border, opacity: action.disabled ? 0.55 : 1 }]}
            >
              <Text style={[styles.outlineLabel, { color: colors.textOnSurface }]}>{action.label}</Text>
            </TouchableOpacity>
          ))}
          {footnote ? (
            <TouchableOpacity
              accessibilityRole="button"
              disabled={footnote.disabled}
              testID={footnote.testID}
              onPress={footnote.onPress}
              style={styles.footnote}
            >
              <Text style={[styles.footnoteLabel, { color: colors.destructive, opacity: footnote.disabled ? 0.55 : 1 }]}>
                {footnote.label}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
            <Text style={[styles.closeLabel, { color: colors.primary }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  backdrop: { backgroundColor: 'rgba(10,17,40,0.45)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, alignItems: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, marginBottom: 18 },
  avatarRing: { borderWidth: 6, borderRadius: 58, padding: 2, marginBottom: 16 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  avatarLarge: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.4, textAlign: 'center' },
  line: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, marginTop: 4, textAlign: 'center' },
  actions: { alignSelf: 'stretch', flexDirection: 'row', gap: 10, marginTop: 22 },
  filled: { flex: 1, minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  filledLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  outline: { flex: 1, minHeight: 50, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  outlineLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  extra: { alignSelf: 'stretch', minHeight: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  footnote: { minHeight: 44, justifyContent: 'center', marginTop: 4 },
  footnoteLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  close: { minHeight: 48, justifyContent: 'center', marginTop: 4 },
  closeLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
});
