/**
 * Device-local flight IDs the signed-in member has opened for review.
 * An ID is not evidence that the member joined that queue.
 */

export const QUEUE_CANDIDATE_LIMIT = 20;
export const QUEUE_CANDIDATE_STORAGE_VERSION = 1;

const CLERK_USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface QueueCandidateStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

export function normalizeQueueCandidateId(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : null;
  if (numeric === null || !Number.isSafeInteger(numeric) || numeric < 1) return null;
  return numeric;
}

export function queueCandidateStorageKey(clerkUserId: string): string | null {
  const id = clerkUserId.trim();
  if (!CLERK_USER_ID.test(id)) return null;
  return `bluebird.queue-candidates.${id}`;
}

export function addQueueCandidate(existing: readonly number[], flightId: number): number[] | null {
  const id = normalizeQueueCandidateId(flightId);
  if (id === null) return null;
  const kept = existing.filter((item) => normalizeQueueCandidateId(item) === item && item !== id);
  return [id, ...kept].slice(0, QUEUE_CANDIDATE_LIMIT);
}

export function parseStoredQueueCandidates(raw: string | null): number[] {
  if (raw === null || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const record = parsed as { v?: unknown; ids?: unknown };
  if (record.v !== QUEUE_CANDIDATE_STORAGE_VERSION || !Array.isArray(record.ids)) return [];
  const ids: number[] = [];
  for (const value of record.ids) {
    const id = normalizeQueueCandidateId(value);
    if (id !== null && !ids.includes(id)) ids.push(id);
    if (ids.length === QUEUE_CANDIDATE_LIMIT) break;
  }
  return ids;
}

function storedPayload(ids: readonly number[]): string {
  const clean: number[] = [];
  for (const value of ids) {
    const id = normalizeQueueCandidateId(value);
    if (id !== null && !clean.includes(id)) clean.push(id);
    if (clean.length === QUEUE_CANDIDATE_LIMIT) break;
  }
  return JSON.stringify({ v: QUEUE_CANDIDATE_STORAGE_VERSION, ids: clean });
}

export async function loadQueueCandidates(
  storage: QueueCandidateStorage,
  clerkUserId: string,
): Promise<number[]> {
  const key = queueCandidateStorageKey(clerkUserId);
  if (!key) return [];
  return parseStoredQueueCandidates(await storage.getItem(key));
}

export async function saveQueueCandidate(
  storage: QueueCandidateStorage,
  clerkUserId: string,
  flightId: number,
): Promise<number[] | null> {
  const key = queueCandidateStorageKey(clerkUserId);
  const next = key ? addQueueCandidate(await loadQueueCandidates(storage, clerkUserId), flightId) : null;
  if (!key || !next) return null;
  await storage.setItem(key, storedPayload(next));
  return next;
}
