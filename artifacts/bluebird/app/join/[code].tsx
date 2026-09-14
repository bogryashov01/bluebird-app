import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';

export default function ReferralJoinScreen() {
  const colors = useColors();
  const { code } = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    const referralCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    router.replace({
      pathname: '/(auth)/phone',
      params: referralCode ? { referralCode } : {},
    });
  }, [code]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundMid }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}