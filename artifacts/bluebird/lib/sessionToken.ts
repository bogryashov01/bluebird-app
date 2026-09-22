import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  TOKEN_KEY,
  type SessionTokenStore,
  readSessionTokenFrom,
  writeSessionTokenTo,
  clearSessionTokenFrom,
} from './sessionTokenStore';

export { TOKEN_KEY, readSessionTokenFrom, writeSessionTokenTo, clearSessionTokenFrom };
export type { SessionTokenStore };

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function diagnosticLog(message: string, extra?: Record<string, unknown>) {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.warn(`[bluebird auth] ${message}${suffix}`);
}

export function createDefaultSessionTokenStore(): SessionTokenStore {
  return {
    isNative: Platform.OS === 'ios' || Platform.OS === 'android',
    async getSecureItem(key) {
      return SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
    },
    async setSecureItem(key, value) {
      await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
    },
    async deleteSecureItem(key) {
      await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
    },
    async getLegacyItem(key) {
      return AsyncStorage.getItem(key);
    },
    async setLegacyItem(key, value) {
      await AsyncStorage.setItem(key, value);
    },
    async deleteLegacyItem(key) {
      await AsyncStorage.removeItem(key);
    },
    log: diagnosticLog,
  };
}

let defaultStore: SessionTokenStore | null = null;

function activeStore(): SessionTokenStore {
  defaultStore ??= createDefaultSessionTokenStore();
  return defaultStore;
}

export async function readSessionToken(): Promise<string | null> {
  return readSessionTokenFrom(activeStore());
}

export async function writeSessionToken(token: string): Promise<void> {
  return writeSessionTokenTo(activeStore(), token);
}

export async function clearSessionToken(): Promise<void> {
  return clearSessionTokenFrom(activeStore());
}
