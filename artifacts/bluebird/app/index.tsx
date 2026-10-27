import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { getClerkAuthRootDestination } from '@/lib/clerkMemberResolution';
import { useJoinNavDecision } from '@/lib/joinNavDiagnostics';
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
  const clerkRootDestination = authMode === 'clerk' && clerkStartupState === 'ready' && clerkSignedIn
    ? getClerkAuthRootDestination({
      clerkSignedIn,
      resolution: clerkMemberResolution,
      readiness: {
        ...CLERK_MEMBER_NAVIGATION_READINESS,
        linkedMember: CLERK_MEMBER_NAVIGATION_READINESS.linkedMember && memberAccessResolved,
      },
    })
    : null;
  const rootDestination = demoMode
    ? '/(tabs)/discover'
    : authMode === 'clerk'
      ? (clerkRootDestination ?? '/(clerk-auth)/sign-in')
      : isLoading
        ? 'none'
        : token && user
          ? '/(tabs)/discover'
          : '/(auth)/splash';
  const rootReason = demoMode
    ? 'full-app-demo'
    : authMode === 'clerk'
      ? (clerkRootDestination ? `clerk-root-${clerkMemberResolution.status}` : 'clerk-not-ready')
      : isLoading
        ? 'legacy-loading'
        : token && user
          ? 'legacy-session'
          : 'legacy-signed-out';
  useJoinNavDecision('index', `${rootReason}|${rootDestination}`, {
    reason: rootReason,
    destination: rootDestination,
    authMode,
    clerkSignedIn,
    resolution: clerkMemberResolution.status,
  });

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
