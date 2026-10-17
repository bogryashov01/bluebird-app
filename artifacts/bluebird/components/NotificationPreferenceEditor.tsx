import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type {
  NotificationChannel,
  ProductionNotificationPrefs,
  ProductionUserProfile,
} from '@/lib/productionAuthApi';
import { buildNotificationProfileUpdate } from '@/lib/clerkNotificationPreferences';

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'both', label: 'Both' },
];

const MODES: { value: ProductionNotificationPrefs['mode']; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'all', label: 'All Flights' },
  { value: 'specific', label: 'Specific Flights' },
];

type ChannelPreferenceKey =
  | 'allChannels'
  | 'emptyLegHomeAirport'
  | 'departingFavorite'
  | 'arrivingFavorite'
  | 'queueUpdates'
  | 'winningNotifications';

function getSmsUnavailableReason(profile: ProductionUserProfile): string | null {
  if (
    profile.smsConsent &&
    profile.phoneE164 &&
    profile.phoneVerifiedAt &&
    !profile.phoneVerificationRequired
  ) return null;
  return 'SMS requires consent and a verified phone number.';
}

function emailSafeCandidate(prefs: ProductionNotificationPrefs): ProductionNotificationPrefs {
  const withoutSms = (channel: NotificationChannel | null) =>
    channel === 'sms' || channel === 'both' ? 'email' : channel;
  return {
    ...prefs,
    mode: 'off',
    allChannels: withoutSms(prefs.allChannels),
    emptyLegHomeAirport: withoutSms(prefs.emptyLegHomeAirport),
    departingFavorite: withoutSms(prefs.departingFavorite),
    arrivingFavorite: withoutSms(prefs.arrivingFavorite),
    queueUpdates: withoutSms(prefs.queueUpdates) ?? 'email',
    winningNotifications: withoutSms(prefs.winningNotifications) ?? 'email',
  };
}

function Choice({
  label,
  selected,
  disabled,
  onPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      key={label}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={{
        minHeight: 42,
        paddingHorizontal: 14,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary : colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.48 : 1,
      }}
    >
      <Text style={{
        color: selected ? colors.primaryForeground : colors.textOnSurface,
        fontFamily: 'Inter_600SemiBold',
        fontSize: 13,
      }}>{label}</Text>
    </TouchableOpacity>
  );
}

function ChannelSelector({
  label,
  value,
  profile,
  disabled,
  onChange,
  testPrefix,
}: {
  label: string;
  value: NotificationChannel | null;
  profile: ProductionUserProfile;
  disabled: boolean;
  onChange: (value: NotificationChannel) => void;
  testPrefix: string;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 9 }}>
      <Text style={{ color: colors.textOnSurface, fontFamily: 'Inter_500Medium', fontSize: 14 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {CHANNELS.map((channel) => {
          const smsBlocked = channel.value !== 'email' && (
            !profile.smsConsent || !profile.phoneE164 || !profile.phoneVerifiedAt || profile.phoneVerificationRequired
          );
          return (
            <Choice
              key={channel.value}
              label={channel.label}
              accessibilityLabel={`${label}: ${channel.value}`}
              selected={value === channel.value}
              disabled={disabled || smsBlocked}
              onPress={() => onChange(channel.value)}
              testID={`${testPrefix}-${channel.value}`}
            />
          );
        })}
      </View>
    </View>
  );
}

function PreferenceCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{
      padding: 16,
      gap: 14,
      borderRadius: 18,
      backgroundColor: colors.surface,
    }}>
      <Text style={{
        color: colors.textOnSurface,
        fontFamily: 'Inter_700Bold',
        fontSize: 15,
      }}>{title}</Text>
      {children}
    </View>
  );
}

export function NotificationPreferenceEditor({ profile, disabled, onSave, onRefresh }: {
  profile: ProductionUserProfile;
  disabled: boolean;
  onSave: (prefs: ProductionNotificationPrefs) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState<ProductionNotificationPrefs | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Validate that the profile itself can support a safe edit. Existing SMS
  // values may now be ineligible, but must remain editable to Email.
  const safe = !!buildNotificationProfileUpdate(
    profile,
    emailSafeCandidate(profile.notificationPrefs),
  );
  const smsUnavailableReason = getSmsUnavailableReason(profile);

  if (!safe) return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.mutedForegroundLight, fontSize: 13, lineHeight: 19 }}>
        Complete your profile to edit these preferences.
      </Text>
      {smsUnavailableReason ? (
        <Text style={{ color: colors.mutedForegroundLight, fontSize: 12, lineHeight: 18 }}>
          {smsUnavailableReason}
        </Text>
      ) : null}
    </View>
  );

  if (!draft) return (
    <View style={{ gap: 12 }}>
      {smsUnavailableReason ? (
        <Text style={{ color: colors.mutedForegroundLight, fontSize: 12, lineHeight: 18 }}>
          {smsUnavailableReason}
        </Text>
      ) : null}
      {needsRefresh ? (
        <Text style={{ color: colors.destructive, fontSize: 13 }}>
          No save is confirmed. Refresh preferences before editing again.
        </Text>
      ) : null}
      <TouchableOpacity
        accessibilityRole="button"
        testID="clerk-edit-notification-preferences"
        disabled={disabled || needsRefresh}
        onPress={() => setDraft({ ...profile.notificationPrefs })}
        style={{
          minHeight: 40,
          alignSelf: 'flex-start',
          justifyContent: 'center',
          paddingHorizontal: 4,
          opacity: disabled || needsRefresh ? 0.5 : 1,
        }}
      >
        <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
          Edit preferences
        </Text>
      </TouchableOpacity>
    </View>
  );

  const blocked = pending || disabled || needsRefresh;
  const setChannel = (key: ChannelPreferenceKey, value: NotificationChannel) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };
  const modeLabel = MODES.find((mode) => mode.value === draft.mode)?.label ?? 'Off';

  return (
    <View style={{ gap: 12 }}>
      <PreferenceCard title="Flights">
        <View style={{ gap: 9 }}>
          <Text style={{ color: colors.textOnSurface, fontFamily: 'Inter_500Medium', fontSize: 14 }}>
            Flight alert mode
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODES.map((mode) => (
              <Choice
                key={mode.value}
                label={mode.label}
                accessibilityLabel={`Flight alert mode: ${mode.value}`}
                selected={draft.mode === mode.value}
                disabled={blocked}
                onPress={() => setDraft((current) => current ? { ...current, mode: mode.value } : current)}
                testID={`clerk-notification-mode-${mode.value}`}
              />
            ))}
          </View>
          <Text style={{ color: colors.mutedForegroundLight, fontSize: 12 }}>
            Current mode: {modeLabel}
          </Text>
        </View>
        {draft.mode === 'all' ? (
          <ChannelSelector
            label="All flight alerts"
            value={draft.allChannels}
            profile={profile}
            disabled={blocked}
            onChange={(value) => setChannel('allChannels', value)}
            testPrefix="clerk-notification-all-channel"
          />
        ) : null}
        {draft.mode === 'specific' ? (
          <>
            <ChannelSelector
              label="Home airport flights"
              value={draft.emptyLegHomeAirport}
              profile={profile}
              disabled={blocked}
              onChange={(value) => setChannel('emptyLegHomeAirport', value)}
              testPrefix="clerk-notification-home-channel"
            />
            <ChannelSelector
              label="Departing from favorite airports"
              value={draft.departingFavorite}
              profile={profile}
              disabled={blocked}
              onChange={(value) => setChannel('departingFavorite', value)}
              testPrefix="clerk-notification-departing-channel"
            />
            <ChannelSelector
              label="Arriving at favorite airports"
              value={draft.arrivingFavorite}
              profile={profile}
              disabled={blocked}
              onChange={(value) => setChannel('arrivingFavorite', value)}
              testPrefix="clerk-notification-arriving-channel"
            />
          </>
        ) : null}
        {smsUnavailableReason ? (
          <Text style={{ color: colors.mutedForegroundLight, fontSize: 12, lineHeight: 18 }}>
            {smsUnavailableReason}
          </Text>
        ) : null}
        <View style={{ height: 1, backgroundColor: colors.separator }} />
        <ChannelSelector
          label="Queue Updates"
          value={draft.queueUpdates}
          profile={profile}
          disabled={blocked}
          onChange={(value) => setChannel('queueUpdates', value)}
          testPrefix="clerk-notification-queue-channel"
        />
        <View style={{ height: 1, backgroundColor: colors.separator }} />
        <ChannelSelector
          label="Flight Confirmations"
          value={draft.winningNotifications}
          profile={profile}
          disabled={blocked}
          onChange={(value) => setChannel('winningNotifications', value)}
          testPrefix="clerk-notification-confirmation-channel"
        />
      </PreferenceCard>

      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 13 }} testID="clerk-notification-save-error">
          {error}
        </Text>
      ) : null}
      {pending ? <ActivityIndicator color={colors.primary} /> : null}
      <TouchableOpacity
        accessibilityRole="button"
        testID="clerk-save-notification-preferences"
        disabled={blocked || !buildNotificationProfileUpdate(profile, draft)}
        onPress={async () => {
          setPending(true);
          setError(null);
          try {
            await onSave(draft);
            setDraft(null);
          } catch {
            setNeedsRefresh(true);
            setError('Couldn’t verify your changes. Refresh preferences before trying again.');
          } finally {
            setPending(false);
          }
        }}
        style={{ padding: 14, backgroundColor: colors.primary, borderRadius: 12, opacity: blocked ? 0.5 : 1 }}
      >
        <Text style={{ color: colors.primaryForeground, textAlign: 'center', fontFamily: 'Inter_600SemiBold' }}>
          {pending ? 'Saving…' : 'Save preferences'}
        </Text>
      </TouchableOpacity>
      {needsRefresh ? (
        <TouchableOpacity
          accessibilityRole="button"
          testID="clerk-refresh-notification-preferences-after-save"
          disabled={pending || refreshing || disabled}
          onPress={async () => {
            setRefreshing(true);
            try {
              await onRefresh();
            } catch {
              setError('Couldn’t refresh preferences. Try again.');
            } finally {
              setRefreshing(false);
            }
          }}
          style={{ padding: 12 }}
        >
          <Text style={{ color: colors.primary, textAlign: 'center' }}>
            {refreshing ? 'Refreshing…' : 'Refresh preferences'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          disabled={pending}
          onPress={() => { setDraft(null); setError(null); }}
          style={{ padding: 12 }}
        >
          <Text style={{ color: colors.primary, textAlign: 'center' }}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
