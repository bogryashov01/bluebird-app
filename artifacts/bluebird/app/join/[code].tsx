import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors } from '@/hooks/useColors';
import { isReferralCode, normalizeReferralCode } from '@/lib/referralProgram';
import { savePendingReferralCode } from '@/lib/pendingReferralCode';

export default function ReferralJoinScreen() {
  const colors = useColors();
  const { code } = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    let cancelled = false;
    const referralCode = typeof code === 'string' ? normalizeReferralCode(code) : '';
    const continueToSignup = () => {
      if (!cancelled) {
        router.replace({
          pathname: '/(auth)/phone',
          params: isReferralCode(referralCode) ? { referralCode } : {},
        });
      }
    };
    if (isReferralCode(referralCode)) {
      void savePendingReferralCode(referralCode, AsyncStorage).then(continueToSignup, continueToSignup);
    } else {
      continueToSignup();
    }
    return () => { cancelled = true; };
  }, [code]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundMid }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}