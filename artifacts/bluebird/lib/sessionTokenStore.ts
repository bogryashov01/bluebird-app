export const TOKEN_KEY = 'bluebird_token';

export type SessionTokenStore = {
  isNative: boolean;
  getSecureItem: (key: string) => Promise<string | null>;
  setSecureItem: (key: string, value: string) => Promise<void>;
  deleteSecureItem: (key: string) => Promise<void>;
  getLegacyItem: (key: string) => Promise<string | null>;
  setLegacyItem: (key: string, value: string) => Promise<void>;
  deleteLegacyItem: (key: string) => Promise<void>;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

function log(store: SessionTokenStore, message: string, extra?: Record<string, unknown>) {
  store.log?.(message, extra);
}

async function deleteLegacyQuietly(store: SessionTokenStore): Promise<void> {
  try {
    await store.deleteLegacyItem(TOKEN_KEY);
  } catch (error) {
    log(store, 'failed to remove legacy AsyncStorage token', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
}

async function persistNativeToken(store: SessionTokenStore, token: string): Promise<void> {
  await store.setSecureItem(TOKEN_KEY, token);
  const verified = await store.getSecureItem(TOKEN_KEY);
  if (verified !== token) {
    throw new Error('SecureStore write could not be verified');
  }
}

/**
 * Reads the session JWT. Native: SecureStore, with a one-time migration from
 * AsyncStorage. Web: AsyncStorage / localStorage. Never writes the JWT back
 * to AsyncStorage on native.
 */
export async function readSessionTokenFrom(store: SessionTokenStore): Promise<string | null> {
  if (!store.isNative) {
    return store.getLegacyItem(TOKEN_KEY);
  }

  let secureToken: string | null = null;
  try {
    secureToken = await store.getSecureItem(TOKEN_KEY);
  } catch (error) {
    log(store, 'SecureStore read failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }

  if (secureToken) {
    const legacy = await store.getLegacyItem(TOKEN_KEY).catch(() => null);
    if (legacy) await deleteLegacyQuietly(store);
    return secureToken;
  }

  let legacyToken: string | null = null;
  try {
    legacyToken = await store.getLegacyItem(TOKEN_KEY);
  } catch (error) {
    log(store, 'legacy token read failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
  if (!legacyToken) return null;

  try {
    await persistNativeToken(store, legacyToken);
    await deleteLegacyQuietly(store);
    log(store, 'migrated session token to SecureStore', { tokenLength: legacyToken.length });
    return legacyToken;
  } catch (error) {
    log(store, 'SecureStore migration failed; not copying token back to AsyncStorage', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }
}

export async function writeSessionTokenTo(store: SessionTokenStore, token: string): Promise<void> {
  if (!store.isNative) {
    // Web Playwright tests and Expo web persist via AsyncStorage → localStorage.
    await store.setLegacyItem(TOKEN_KEY, token);
    return;
  }

  try {
    await persistNativeToken(store, token);
  } catch (error) {
    log(store, 'SecureStore write failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }
  await deleteLegacyQuietly(store);
}

export async function clearSessionTokenFrom(store: SessionTokenStore): Promise<void> {
  const tasks: Array<Promise<void>> = [store.deleteLegacyItem(TOKEN_KEY)];
  if (store.isNative) {
    tasks.unshift(store.deleteSecureItem(TOKEN_KEY));
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed && failed.status === 'rejected') {
    log(store, 'failed to clear session token storage', {
      reason: failed.reason instanceof Error ? failed.reason.message : 'unknown',
    });
  }
}
