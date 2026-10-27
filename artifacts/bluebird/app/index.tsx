import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { getClerkAuthRootDestination } from '@/lib/clerkMemberResolution';
import { CLERK_MEMBER_NAVIGATION_READINESS } from '@/lib/productionAuthState';

export default function Index() {
  const {
    token,
    user,
    isLoading,
    authMode,
    demoMode,
    clerkSignedIn,
    clerkMemberResolution,
    memberAccessResolved,
    clerkStartupState,
  } = useAuth();
  const colors = useColors();

  if (demoMode) return <Redirect href="/(tabs)/discover" />;

  if (authMode === 'clerk') {
    if (clerkStartupState !== 'ready' || !clerkSignedIn) {
      return <Redirect href="/(clerk-auth)/sign-in" />;
    }
    const destination = getClerkAuthRootDestination({
      clerkSignedIn,
      resolution: clerkMemberResolution,
      readiness: {
        ...CLERK_MEMBER_NAVIGATION_READINESS,
        linkedMember: CLERK_MEMBER_NAVIGATION_READINESS.linkedMember && memberAccessResolved,
      },
    });
    return <Redirect href={destination} />;
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.backgroundMid, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (token && user) {
    return <Redirect href="/(tabs)/discover" />;
  }

  return <Redirect href="/(auth)/splash" />;
}
