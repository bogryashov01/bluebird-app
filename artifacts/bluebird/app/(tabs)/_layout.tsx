import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useTheme } from '@/context/ThemeContext';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnreadNotificationsCount } from '@/hooks/useUnreadNotifications';
import { CLERK_MEMBER_NAVIGATION_READINESS } from '@/lib/productionAuthState';
import { isClerkHomeAvailable } from '@/lib/clerkMemberResolution';

function NativeTabLayout({ unreadCount }: { unreadCount: number }) {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index" hidden />
      <NativeTabs.Trigger name="discover/index">
        <NativeTabs.Trigger.Icon sf={{ default: 'paperplane', selected: 'paperplane.fill' }} />
        <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="trips/index">
        <NativeTabs.Trigger.Icon sf={{ default: 'briefcase', selected: 'briefcase.fill' }} />
        <NativeTabs.Trigger.Label>Trips</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="membership/index">
        <NativeTabs.Trigger.Icon sf={{ default: 'star', selected: 'star.fill' }} />
        <NativeTabs.Trigger.Label>Membership</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile/index">
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unreadCount === 0}>{String(unreadCount)}</NativeTabs.Trigger.Badge>
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
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.discoverMutedForeground,
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: isIOS ? 'transparent' : colors.discoverCard,
            borderTopWidth: 1,
            borderTopColor: colors.discoverBorder,
            elevation: 0,
            ...(isWeb ? { height: 84 } : {}),
            paddingBottom: isWeb ? 34 : insets.bottom,
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.discoverCard }]} />
            ),
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
      <Tabs.Screen name="connections" options={{ href: null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  const { preference } = useTheme();
  const unreadCount = useUnreadNotificationsCount();
  const { token, isLoading, authMode, clerkSignedIn, clerkMemberResolution, demoMode } = useAuth();
  const colors = useColors();
  const registeredHomeReady = isClerkHomeAvailable(
    clerkMemberResolution,
    CLERK_MEMBER_NAVIGATION_READINESS,
  );
  if (demoMode) {
    if (isLiquidGlassAvailable() && preference === 'system') {
      return <NativeTabLayout unreadCount={0} />;
    }
    return <ClassicTabLayout unreadCount={0} />;
  }
  // Do not mount tab screens while the stored demo session is being checked.
  // A direct /discover route otherwise renders Flights briefly before the
  // signed-out redirect runs.
  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (authMode === 'clerk') {
    if (!clerkSignedIn || !registeredHomeReady) {
      return clerkSignedIn
        ? <Redirect href="/(clerk-auth)/signed-in" />
        : <Redirect href="/(clerk-auth)/sign-in" />;
    }
    if (isLiquidGlassAvailable() && preference === 'system') {
      return <NativeTabLayout unreadCount={0} />;
    }
    return <ClassicTabLayout unreadCount={0} />;
  }
  // Centralized guard: no session → auth flow. Prevents deep links from
  // bypassing sign-in.
  if (!token) return <Redirect href="/(auth)/splash" />;
  // Native tabs follow the OS appearance only — use them just when the user's
  // theme preference is "System"; a forced Light/Dark needs the themed classic tabs.
  if (isLiquidGlassAvailable() && preference === 'system') {
    return <NativeTabLayout unreadCount={unreadCount} />;
  }
  return <ClassicTabLayout unreadCount={unreadCount} />;
}
