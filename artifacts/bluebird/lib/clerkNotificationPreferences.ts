import type { ProductionNotificationPrefs, ProductionUserProfile } from './productionAuthApi';

export interface ClerkNotificationProfileSession {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  userId: string | null;
}

export interface ClerkNotificationProfileReader {
  getProfile: (options?: { signal?: AbortSignal }) => Promise<ProductionUserProfile>;
}

/**
 * Read only the preference projection from the authenticated profile.
 * The server's profile GET may synchronize verified phone fields; callers
 * must make that side effect explicit before invoking this function.
 */
export async function readClerkNotificationPreferences(input: {
  getCurrentSession: () => ClerkNotificationProfileSession | null;
  requestedClerkUserId: string;
  readProfile: ClerkNotificationProfileReader['getProfile'];
  signal?: AbortSignal;
}): Promise<ProductionNotificationPrefs> {
  const isRequestedIdentityCurrent = () => {
    const session = input.getCurrentSession();
    return session?.isLoaded === true &&
      session.isSignedIn === true &&
      session.userId === input.requestedClerkUserId;
  };

  if (!isRequestedIdentityCurrent()) {
    throw new Error('The signed-in account changed before preferences could be loaded.');
  }

  const profile = await input.readProfile({ signal: input.signal });

  if (!isRequestedIdentityCurrent()) {
    throw new Error('The signed-in account changed while preferences were loading.');
  }

  return profile.notificationPrefs;
}
