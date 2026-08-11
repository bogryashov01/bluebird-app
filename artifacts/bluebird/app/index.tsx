import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function Index() {
  const { token, user, isLoading } = useAuth();
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.backgroundMid, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (token) {
    // Unverified members must finish email verification before entering the
    // app — relaunching mid-signup resumes on the verification screen.
    if (user && !user.emailVerified) {
      return <Redirect href="/(auth)/verify-email" />;
    }
    return <Redirect href="/(tabs)/discover" />;
  }

  return <Redirect href="/(auth)/splash" />;
}
