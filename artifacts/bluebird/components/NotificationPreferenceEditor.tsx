import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { ProductionNotificationPrefs, ProductionUserProfile } from '@/lib/productionAuthApi';
import { buildNotificationProfileUpdate, notificationPreferenceRows } from '@/lib/clerkNotificationPreferences';

export function NotificationPreferenceEditor({ profile, disabled, onSave }: {
  profile: ProductionUserProfile;
  disabled: boolean;
  onSave: (prefs: ProductionNotificationPrefs) => Promise<void>;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState<ProductionNotificationPrefs | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const safe = !!buildNotificationProfileUpdate(profile, profile.notificationPrefs);
  if (!safe) return (
    <Text style={{ color: colors.mutedForegroundLight, fontSize: 13 }}>
      Read-only: a complete valid profile and any required existing SMS consent and verified phone are needed for a safe full profile update.
    </Text>
  );
  if (!draft) return (
    <View style={{ gap: 10 }}>
      {needsRefresh && <Text style={{ color: colors.destructive }}>
        No save is confirmed. Refresh preferences before editing again.
      </Text>}
      <TouchableOpacity accessibilityRole="button" testID="clerk-edit-notification-preferences"
      disabled={disabled || needsRefresh} onPress={() => setDraft({ ...profile.notificationPrefs })}
      style={{ padding: 14, borderRadius: 14, backgroundColor: colors.primary, opacity: disabled || needsRefresh ? 0.5 : 1 }}>
      <Text style={{ color: colors.primaryForeground, textAlign: 'center' }}>Edit preferences</Text>
      </TouchableOpacity>
    </View>
  );
  const blocked = pending || disabled || needsRefresh;
  return (
    <View style={{ padding: 16, gap: 14, borderRadius: 18, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.mutedForegroundLight }}>
        Unsaved changes. Saving re-reads your profile, preserves its required fields, and refreshes preferences after the API accepts the update. Profile reads may synchronize your verified phone. SMS requires existing consent; this screen cannot grant it.
      </Text>
      {notificationPreferenceRows(draft).map(({ key, label, value }) => {
        const options = key === 'mode' ? ['off', 'all', 'specific'] :
          key === 'queueUpdates' || key === 'winningNotifications' ? ['email', 'sms', 'both'] :
            [null, 'email', 'sms', 'both'];
        return (
          <View key={key} style={{ gap: 8 }}>
            <Text style={{ color: colors.textOnSurface }}>{label}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {options.map((option) => {
                const smsBlocked = (option === 'sms' || option === 'both') &&
                  (!profile.smsConsent || !profile.phoneE164 || !profile.phoneVerifiedAt || profile.phoneVerificationRequired);
                const selected = value === option;
                return (
                  <TouchableOpacity key={option ?? 'unset'} accessibilityRole="radio"
                    accessibilityLabel={`${label}: ${option ?? 'Not set'}`}
                    aria-checked={selected}
                    accessibilityState={{ checked: selected, disabled: blocked || smsBlocked }}
                    disabled={blocked || smsBlocked}
                    onPress={() => setDraft({ ...draft, [key]: option } as ProductionNotificationPrefs)}
                    style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
                      backgroundColor: selected ? colors.primary : colors.surface, opacity: blocked || smsBlocked ? 0.5 : 1 }}>
                    <Text style={{ color: selected ? colors.primaryForeground : colors.textOnSurface }}>
                      {option === null ? 'Not set' : option === 'both' ? 'Email + SMS' : option === 'sms' ? 'SMS' : option === 'email' ? 'Email' : option === 'off' ? 'Off' : option === 'all' ? 'All flights' : 'Specific flights'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
      {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
      {pending && <ActivityIndicator color={colors.primary} />}
      <TouchableOpacity accessibilityRole="button" testID="clerk-save-notification-preferences"
        disabled={blocked || !buildNotificationProfileUpdate(profile, draft)}
        onPress={async () => {
          setPending(true);
          setError(null);
          try {
            await onSave(draft);
            setDraft(null);
          } catch (failure) {
            setNeedsRefresh(true);
            setError(`${failure instanceof Error ? failure.message : 'Update could not be verified.'} No save is confirmed. Refresh preferences before editing again; a request may already have reached the server.`);
          } finally { setPending(false); }
        }} style={{ padding: 14, backgroundColor: colors.primary, borderRadius: 12, opacity: blocked ? 0.5 : 1 }}>
        <Text style={{ color: colors.primaryForeground, textAlign: 'center' }}>{pending ? 'Saving and refreshing…' : 'Save preferences'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={pending} onPress={() => { setDraft(null); setError(null); }}
        style={{ padding: 12 }}>
        <Text style={{ color: colors.primary, textAlign: 'center' }}>{needsRefresh ? 'Close editor and refresh' : 'Cancel'}</Text>
      </TouchableOpacity>
    </View>
  );
}
