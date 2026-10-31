import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export function SupportPage({
  title,
  testID,
  backTestID,
  children,
}: {
  title: string;
  testID: string;
  backTestID: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const goToProfile = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  };

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.offWhite, paddingTop: topPad + 12, paddingBottom: insets.bottom },
      ]}
      testID={testID}
    >
      <TouchableOpacity
        onPress={goToProfile}
        style={[styles.backButton, { backgroundColor: colors.surface }]}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Back to Profile"
        testID={backTestID}
      >
        <Feather name="chevron-left" size={23} color={colors.textOnSurface} />
      </TouchableOpacity>
      <Text style={[styles.pageTitle, { color: colors.textOnSurface }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 22,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  pageTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    lineHeight: 33,
    marginBottom: 20,
  },
});
