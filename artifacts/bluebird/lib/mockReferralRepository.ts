import {
  isReferralCode,
  mapReferralStatistics,
  normalizeReferralCode,
  type InviteValidationResult,
  type MembershipPricingPreview,
  type ReferralRepository,
  type ReferralSnapshot,
} from './referralProgram';

export interface ReferralStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface MockReferralFixture {
  code: string;
  inviteUrl: string;
  statistics: {
    friendsActivated: number;
    creditEarnedCents: number;
    creditAppliedCents: number;
    balanceCents: number;
  };
}

interface StoredReferralRecord {
  version: 1;
  snapshot: ReferralSnapshot;
}

export class MockReferralRepository implements ReferralRepository {
  private snapshot: ReferralSnapshot | null = null;
  private loaded = false;

  constructor(
    private readonly storage: ReferralStorage,
    private readonly storageKey: string,
    private readonly fixture: MockReferralFixture,
  ) {}

  async getReferralSnapshot(): Promise<ReferralSnapshot> {
    if (this.loaded && this.snapshot) return this.copySnapshot(this.snapshot);
    const raw = await this.storage.getItem(this.storageKey);
    const snapshot = raw === null
      ? this.fixtureSnapshot()
      : parseStoredReferralRecord(raw);
    this.snapshot = snapshot;
    await this.persist(snapshot);
    this.loaded = true;
    return this.copySnapshot(snapshot);
  }

  async validateCode(code: string): Promise<InviteValidationResult> {
    const normalized = normalizeReferralCode(code);
    return { valid: normalized === this.fixture.code, code: normalized };
  }

  async previewMembershipPricing(
    tier: 'base' | 'plus',
    code: string,
  ): Promise<MembershipPricingPreview> {
    const validation = await this.validateCode(code);
    return {
      tier,
      inviteCode: validation.valid ? validation.code : null,
      referralDiscountCents: validation.valid ? 50_000 : 0,
    };
  }

  async simulateQualifyingActivation(): Promise<ReferralSnapshot> {
    const current = this.snapshot ?? await this.getReferralSnapshot();
    const updated: ReferralSnapshot = {
      ...current,
      statistics: mapReferralStatistics({
        friendsActivated: current.statistics.friendsActivated + 1,
        creditEarnedCents: current.statistics.creditEarnedCents + 100_000,
        creditAppliedCents: current.statistics.creditAppliedCents,
        balanceCents: current.statistics.balanceCents + 100_000,
      }),
    };
    await this.persist(updated);
    this.snapshot = updated;
    return this.copySnapshot(updated);
  }

  private fixtureSnapshot(): ReferralSnapshot {
    if (!isReferralCode(this.fixture.code) || !this.fixture.inviteUrl.trim()) {
      throw new Error('The local referral fixture is invalid.');
    }
    return {
      code: this.fixture.code,
      inviteUrl: this.fixture.inviteUrl,
      statistics: mapReferralStatistics(this.fixture.statistics),
    };
  }

  private async persist(snapshot: ReferralSnapshot): Promise<void> {
    const record: StoredReferralRecord = { version: 1, snapshot };
    await this.storage.setItem(this.storageKey, JSON.stringify(record));
  }

  private copySnapshot(snapshot: ReferralSnapshot): ReferralSnapshot {
    return { ...snapshot, statistics: { ...snapshot.statistics } };
  }
}

export function createMockReferralRepository(input: {
  storage: ReferralStorage;
  accountId: string;
  fixture: MockReferralFixture;
}): MockReferralRepository {
  return new MockReferralRepository(
    input.storage,
    createReferralDemoStorageKey(input.accountId),
    input.fixture,
  );
}

function parseStoredReferralRecord(raw: string): ReferralSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved referral demo data could not be read.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Saved referral demo data is invalid.');
  }
  const record = parsed as Partial<StoredReferralRecord>;
  const snapshot = record.snapshot;
  if (
    record.version !== 1 ||
    !snapshot ||
    !isReferralCode(snapshot.code) ||
    typeof snapshot.inviteUrl !== 'string' ||
    !snapshot.inviteUrl.trim() ||
    !snapshot.statistics
  ) {
    throw new Error('Saved referral demo data is invalid.');
  }
  return {
    code: snapshot.code,
    inviteUrl: snapshot.inviteUrl,
    statistics: mapReferralStatistics(snapshot.statistics),
  };
}

export function createReferralDemoStorageKey(accountId: string): string {
  const normalized = accountId.trim();
  if (!normalized) throw new TypeError('An account ID is required to scope referral demo data.');
  return `bluebird.referral-demo.v1.${encodeURIComponent(normalized)}`;
}
