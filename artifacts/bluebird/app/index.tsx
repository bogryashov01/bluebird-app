import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { getAvailableClerkMemberDestination } from '@/lib/clerkMemberResolution';
import { CLERK_MEMBER_NAVIGATION_READINESS } from '@/lib/productionAuthState';

export default function Index() {
  const {
    token,
    user,
    isLoading,
    authMode,
    clerkSignedIn,
    clerkMemberResolution,
    memberAccessResolved,
  } = useAuth();
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.backgroundMid, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (authMode === 'clerk') {
    const destination = getAvailableClerkMemberDestination(clerkMemberResolution, {
      ...CLERK_MEMBER_NAVIGATION_READINESS,
      linkedMember: CLERK_MEMBER_NAVIGATION_READINESS.linkedMember && memberAccessResolved,
    });
    if (destination) return <Redirect href={destination} />;
    return clerkSignedIn
      ? <Redirect href="/(clerk-auth)/signed-in" />
      : <Redirect href="/(auth)/splash" />;
  }

  if (token && user) {
    return <Redirect href="/(tabs)/discover" />;
  }

  return <Redirect href="/(auth)/splash" />;
}
