import { isReferralCode, normalizeReferralCode } from './referralProgram';

const PENDING_REFERRAL_CODE_KEY = 'bluebird.pending-referral-code.v1';

export interface PendingReferralStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export async function savePendingReferralCode(
  code: string,
  storage: PendingReferralStorage,
): Promise<string> {
  const normalized = normalizeReferralCode(code);
  if (!isReferralCode(normalized)) throw new TypeError('The referral code is invalid.');
  await storage.setItem(PENDING_REFERRAL_CODE_KEY, normalized);
  return normalized;
}

export async function readPendingReferralCode(
  storage: PendingReferralStorage,
): Promise<string | null> {
  const stored = await storage.getItem(PENDING_REFERRAL_CODE_KEY);
  if (!stored) return null;
  const normalized = normalizeReferralCode(stored);
  return isReferralCode(normalized) ? normalized : null;
}

/** Call only after the Main API confirms the membership activation consumed the code. */
export async function clearPendingReferralCode(
  storage: PendingReferralStorage,
): Promise<void> {
  await storage.removeItem(PENDING_REFERRAL_CODE_KEY);
}

export const PENDING_REFERRAL_CODE_STORAGE_KEY = PENDING_REFERRAL_CODE_KEY;
