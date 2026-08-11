import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useTheme } from '@/context/ThemeContext';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { Badge, Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnreadNotificationsCount } from '@/hooks/useUnreadNotifications';

function NativeTabLayout({ unreadCount }: { unreadCount: number }) {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index" hidden />
      <NativeTabs.Trigger name="discover/index">
        <Icon sf={{ default: 'paperplane', selected: 'paperplane.fill' }} />
        <Label>Discover</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="trips/index">
        <Icon sf={{ default: 'briefcase', selected: 'briefcase.fill' }} />
        <Label>Trips</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="membership/index">
        <Icon sf={{ default: 'star', selected: 'star.fill' }} />
        <Label>Membership</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile/index">
        <Icon sf={{ default: 'person', selected: 'person.fill' }} />
        <Label>Profile</Label>
        <Badge hidden={unreadCount === 0}>{String(unreadCount)}</Badge>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout({ unreadCount }: { unreadCount: number }) {
  const colors = useColors();
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
          paddingBottom: isWeb ? 34 : insets.bottom,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint={colors.scheme === 'dark' ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
          ) : null,
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen
        name="discover/index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="airplane" tintColor={color} size={22} />
            ) : (
              <Feather name="send" size={20} color={color} style={{ transform: [{ rotate: '-45deg' }] }} />
            ),
        }}
      />
      <Tabs.Screen
        name="trips/index"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="briefcase" tintColor={color} size={22} />
            ) : (
              <Feather name="briefcase" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="membership/index"
        options={{
          title: 'Membership',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="star" tintColor={color} size={22} />
            ) : (
              <Feather name="star" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="profile/index"
        options={{
          title: 'Profile',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.primary,
            color: colors.textOnBrand,
            fontFamily: 'Inter_600SemiBold',
            fontSize: 11,
          },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={22} />
            ) : (
              <Feather name="user" size={20} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { preference } = useTheme();
  const unreadCount = useUnreadNotificationsCount();
  // Native tabs follow the OS appearance only — use them just when the user's
  // theme preference is "System"; a forced Light/Dark needs the themed classic tabs.
  if (isLiquidGlassAvailable() && preference === 'system') {
    return <NativeTabLayout unreadCount={unreadCount} />;
  }
  return <ClassicTabLayout unreadCount={unreadCount} />;
}
