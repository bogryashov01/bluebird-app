import React, { useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type {
  NotificationChannel,
  ProductionNotificationPrefs,
  ProductionUserProfile,
} from '@/lib/productionAuthApi';
import {
  areNotificationPreferencesEqual,
  canPrepareNotificationPreferenceEdit,
} from '@/lib/clerkNotificationPreferences';

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'both', label: 'Both' },
];

function channelHint(value: NotificationChannel | null | undefined): string {
  if (value === 'sms') return 'SMS';
  if (value === 'both') return 'Email + SMS';
  return 'Email';
}

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
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: 10,
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
        fontSize: 12,
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
    <View style={{ gap: 8, paddingLeft: 16, paddingRight: 12, paddingBottom: 12 }}>
      <Text style={{ color: colors.mutedForegroundLight, fontFamily: 'Inter_500Medium', fontSize: 12 }}>
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

type ExpandedRow = 'home' | 'all' | 'queue' | 'confirmations' | null;

function ensuredChannel(channel: NotificationChannel | null): NotificationChannel {
  return channel ?? 'email';
}

function withFlightMode(
  prefs: ProductionNotificationPrefs,
  mode: ProductionNotificationPrefs['mode'],
): ProductionNotificationPrefs {
  if (mode === 'all') {
    return { ...prefs, mode, allChannels: ensuredChannel(prefs.allChannels) };
  }
  if (mode === 'specific') {
    return { ...prefs, mode, emptyLegHomeAirport: ensuredChannel(prefs.emptyLegHomeAirport) };
  }
  return { ...prefs, mode: 'off' };
}

function SettingsSwitch({
  label,
  checked,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      aria-checked={checked}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={{
        width: 46,
        height: 28,
        borderRadius: 14,
        backgroundColor: checked ? colors.primary : colors.muted,
        justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <View style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        marginLeft: checked ? 20 : 2,
        backgroundColor: colors.primaryForeground,
      }} />
    </TouchableOpacity>
  );
}

export function NotificationPreferenceEditor({
  profile,
  disabled,
  persistence = 'account',
  onSave,
  onRefresh,
}: {
  profile: ProductionUserProfile;
  disabled: boolean;
  persistence?: 'account' | 'device';
  onSave: (prefs: ProductionNotificationPrefs) => Promise<void>;
  onRefresh?: () => Promise<void>;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState<ProductionNotificationPrefs>(profile.notificationPrefs);
  const [expanded, setExpanded] = useState<ExpandedRow>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestDraft = useRef(draft);
  const profileRef = useRef(profile);
  const savingRef = useRef(false);
  profileRef.current = profile;
  latestDraft.current = draft;
  const safe = canPrepareNotificationPreferenceEdit(profile);
  const smsUnavailableReason = getSmsUnavailableReason(profile);

  const commit = (next: ProductionNotificationPrefs, nextExpanded: ExpandedRow) => {
    if (disabled || !safe) return;
    if (
      areNotificationPreferencesEqual(next, latestDraft.current) &&
      nextExpanded === expanded
    ) return;
    latestDraft.current = next;
    setDraft(next);
    setExpanded(nextExpanded);
    setError(null);
    if (savingRef.current) return;
    savingRef.current = true;
    setPending(true);
    void (async () => {
      let current = next;
      try {
        while (true) {
          await onSave(current);
          if (areNotificationPreferencesEqual(latestDraft.current, current)) break;
          current = latestDraft.current;
        }
        setError(null);
      } catch {
        const restored = profileRef.current.notificationPrefs;
        latestDraft.current = restored;
        setDraft(restored);
        setExpanded(null);
        setError(persistence === 'device'
          ? 'Couldn’t save on this device.'
          : 'Couldn’t save these preferences.');
      } finally {
        savingRef.current = false;
        setPending(false);
      }
    })();
  };

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

  const blocked = pending || disabled;
  const setMode = (mode: ProductionNotificationPrefs['mode']) => {
    const turningOff = (mode === 'all' && draft.mode === 'all') || (mode === 'specific' && draft.mode === 'specific');
    const nextMode = turningOff ? 'off' : mode;
    commit(
      withFlightMode(draft, nextMode),
      nextMode === 'off' ? null : nextMode === 'all' ? 'all' : 'home',
    );
  };
  const setChannel = (key: ChannelPreferenceKey, value: NotificationChannel) => {
    commit({ ...draft, [key]: value }, expanded);
  };
  const toggleExpanded = (row: Exclude<ExpandedRow, null>) => {
    setExpanded((current) => current === row ? null : row);
  };

  return (
    <View style={{ gap: 8 }}>
      {persistence === 'device' ? (
        <Text style={{ color: colors.mutedForegroundLight, fontSize: 12, lineHeight: 16 }} testID="clerk-device-notification-preferences">
          Saved on this iPhone only—not synced to your Bluebird account.
        </Text>
      ) : null}
      <View style={{ borderRadius: 16, backgroundColor: colors.surface, overflow: 'hidden' }}>
        <FlightRow
          label="Flights from my Home Airport"
          switchLabel="Flights from my Home Airport"
          checked={draft.mode === 'specific'}
          disabled={blocked}
          expanded={expanded === 'home'}
          onToggle={() => setMode('specific')}
          onExpand={() => toggleExpanded('home')}
          testID="clerk-notification-home-switch"
        >
          {draft.mode === 'specific' && expanded === 'home' ? (
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
        </FlightRow>
        <FlightRow
          label="All Flights"
          switchLabel="All Flights"
          checked={draft.mode === 'all'}
          disabled={blocked}
          expanded={expanded === 'all'}
          onToggle={() => setMode('all')}
          onExpand={() => toggleExpanded('all')}
          testID="clerk-notification-all-switch"
        >
          {draft.mode === 'all' && expanded === 'all' ? (
            <ChannelSelector
              label="All flight alerts"
              value={draft.allChannels}
              profile={profile}
              disabled={blocked}
              onChange={(value) => setChannel('allChannels', value)}
              testPrefix="clerk-notification-all-channel"
            />
          ) : null}
        </FlightRow>
        <FlightRow
          label="International Flights"
          switchLabel="International Flights"
          hint="Coming soon"
          checked={false}
          disabled
          expanded={false}
          onToggle={() => undefined}
          onExpand={() => undefined}
          testID="clerk-notification-international-switch"
        />
        <FlightRow
          label="Queue Updates"
          switchLabel="Queue Updates"
          hint={channelHint(draft.queueUpdates)}
          checked
          disabled={blocked}
          expanded={expanded === 'queue'}
          onToggle={() => toggleExpanded('queue')}
          onExpand={() => toggleExpanded('queue')}
          testID="clerk-notification-queue-switch"
          control="channels"
        >
          {expanded === 'queue' ? (
            <ChannelSelector
              label="Queue Updates"
              value={draft.queueUpdates}
              profile={profile}
              disabled={blocked}
              onChange={(value) => setChannel('queueUpdates', value)}
              testPrefix="clerk-notification-queue-channel"
            />
          ) : null}
        </FlightRow>
        <FlightRow
          label="Flight Confirmations"
          switchLabel="Flight Confirmations"
          hint={channelHint(draft.winningNotifications)}
          checked
          disabled={blocked}
          expanded={expanded === 'confirmations'}
          onToggle={() => toggleExpanded('confirmations')}
          onExpand={() => toggleExpanded('confirmations')}
          testID="clerk-notification-confirmation-switch"
          control="channels"
          last
        >
          {expanded === 'confirmations' ? (
            <ChannelSelector
              label="Flight Confirmations"
              value={draft.winningNotifications}
              profile={profile}
              disabled={blocked}
              onChange={(value) => setChannel('winningNotifications', value)}
              testPrefix="clerk-notification-confirmation-channel"
            />
          ) : null}
        </FlightRow>
      </View>
      {smsUnavailableReason ? (
        <Text style={{ color: colors.mutedForegroundLight, fontSize: 12, lineHeight: 16 }}>
          {smsUnavailableReason}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 12, lineHeight: 16 }} testID="clerk-notification-save-error">
          {error}
        </Text>
      ) : null}
      {onRefresh && error ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => { void onRefresh(); }} testID="clerk-refresh-notification-preferences-after-save">
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function FlightRow({
  label,
  switchLabel,
  hint,
  checked,
  disabled,
  expanded,
  onToggle,
  onExpand,
  testID,
  last = false,
  control = 'toggle',
  children,
}: {
  label: string;
  switchLabel: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  testID: string;
  last?: boolean;
  /** `toggle` = mode on/off. `channels` = required email/SMS channel (no off in Main API). */
  control?: 'toggle' | 'channels';
  children?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View>
      <View style={{
        minHeight: 48,
        paddingLeft: 16,
        paddingRight: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${label} channels`}
          accessibilityState={{ expanded, disabled }}
          disabled={disabled && !checked}
          onPress={onExpand}
          style={{ flex: 1, paddingVertical: 10 }}
          testID={control === 'channels' ? testID : undefined}
        >
          <Text style={{ color: colors.textOnSurface, fontFamily: 'Inter_500Medium', fontSize: 15 }}>
            {label}
          </Text>
          {hint ? (
            <Text style={{ color: colors.mutedForegroundLight, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 }}>
              {hint}
            </Text>
          ) : null}
        </TouchableOpacity>
        {control === 'toggle' ? (
          <SettingsSwitch
            label={switchLabel}
            checked={checked}
            disabled={disabled}
            onPress={onToggle}
            testID={testID}
          />
        ) : (
          <Text
            style={{ color: colors.mutedForegroundLight, fontSize: 20, lineHeight: 22 }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {expanded ? '˄' : '›'}
          </Text>
        )}
      </View>
      {children}
      {last ? null : <View style={{ height: 1, marginLeft: 16, backgroundColor: colors.separator }} />}
    </View>
  );
}
