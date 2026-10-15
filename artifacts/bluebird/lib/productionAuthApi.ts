import { requestProductionJson } from './productionRequestTransport';
import {
  getMainBluebirdApiConfiguration,
  getMainBluebirdDevelopmentDiagnosticStatus,
  validateMainBluebirdApiBaseUrl,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';

/**
 * This provider is deliberately isolated from AuthContext and demo JWT storage.
 * A caller must supply an independently verified production access token.
 */
export interface VerifiedProductionTokenProvider {
  environment: MainBluebirdApiEnvironment;
  getVerifiedAccessToken: () => Promise<string | null>;
}

export interface ProductionAuthApiOptions {
  tokenProvider: VerifiedProductionTokenProvider;
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  diagnostic?: ProductionAuthDiagnosticHooks;
}

/** Hooks used only by the explicit Development API diagnostic. */
export interface ProductionAuthDiagnosticHooks {
  expectedUrl: string;
  onTokenResult: (tokenObtained: boolean) => void;
  onFetchInitiated: () => void;
  onFetchCompleted: () => void;
  onFetchFailed: () => void;
}

export class ProductionAuthConfigurationError extends Error {
  constructor() {
    super('Main Bluebird API configuration is invalid.');
    this.name = 'ProductionAuthConfigurationError';
  }
}

export interface ProductionRequestOptions {
  signal?: AbortSignal;
  onResponseStatus?: (status: number) => void;
}

export interface ProductionCurrentUserResponse {
  status: number;
  currentUser: ProductionCurrentUser;
}

export type ProductionHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Nullable<T> = T | null;
export type MembershipTier = 'base' | 'plus';
export type UserGender = 'male' | 'female';
export type NotificationChannel = 'email' | 'sms' | 'both';

export interface ProductionImpersonation {
  active: boolean;
  adminClerkUserId: string;
  adminEmail: Nullable<string>;
  targetClerkUserId: string;
  targetEmail: Nullable<string>;
  targetName: Nullable<string>;
}

/** Exact /api/me projection. Optional properties are omitted by some responses. */
export interface ProductionCurrentUser {
  isAuthenticated: boolean;
  isAdmin: boolean;
  isConcierge: boolean;
  isMember: boolean;
  memberTier: Nullable<MembershipTier>;
  email?: Nullable<string>;
  firstName?: Nullable<string>;
  lastName?: Nullable<string>;
  isProfileComplete: boolean;
  needsPlanDecision: boolean;
  needsSignupPhone: boolean;
  impersonation?: Nullable<ProductionImpersonation>;
}

export interface ProductionNotificationPrefs {
  mode: 'off' | 'all' | 'specific';
  allChannels: Nullable<NotificationChannel>;
  emptyLegHomeAirport: Nullable<NotificationChannel>;
  departingFavorite: Nullable<NotificationChannel>;
  arrivingFavorite: Nullable<NotificationChannel>;
  queueUpdates: NotificationChannel;
  winningNotifications: NotificationChannel;
}

export interface ProductionUpgradeCreditBalances {
  skipTheLine: number;
  internationalPass: number;
}

export interface ProductionUserProfile {
  firstName: Nullable<string>;
  lastName: Nullable<string>;
  dob: Nullable<string>;
  gender: Nullable<UserGender>;
  homeAirportCode: Nullable<string>;
  homeAirportLabel: Nullable<string>;
  favoriteAirportCodes: string[];
  favoriteAirportLabels: string[];
  favoriteCityKeys: string[];
  favoriteCityLabels: string[];
  phoneE164: Nullable<string>;
  phoneCountry: Nullable<string>;
  phoneVerifiedAt: Nullable<string>;
  phoneVerificationRequired: boolean;
  notificationPrefs: ProductionNotificationPrefs;
  smsConsent: boolean;
  smsConsentAt: Nullable<string>;
  smsConsentRevokedAt: Nullable<string>;
  email: Nullable<string>;
  emailLocked: boolean;
  signupChannel: Nullable<'phone' | 'email'>;
  isComplete: boolean;
  upgradeCreditBalances: ProductionUpgradeCreditBalances;
  weightLbs: Nullable<number>;
  updatedAt?: Nullable<string>;
}

/** Verified phone status uses a distinct projection without credit balances. */
export type ProductionPhoneVerifiedProfile = Omit<ProductionUserProfile, 'upgradeCreditBalances' | 'updatedAt'> & {
  updatedAt: Nullable<string>;
};

export interface UpdateProductionUserProfileRequest {
  firstName: string;
  lastName: string;
  dob: string;
  gender: UserGender;
  homeAirportCode: string;
  favoriteCityKeys: string[];
  phoneE164?: Nullable<string>;
  phoneCountry?: Nullable<string>;
  notificationPrefs?: ProductionNotificationPrefs;
  smsConsent?: boolean;
  email?: string;
  weightLbs?: Nullable<number>;
}

export interface ProductionBillingAddress {
  line1: string;
  line2?: Nullable<string>;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface ProductionPaymentMethodOnFile {
  brand: 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'unionpay' | 'unknown';
  last4: string;
  expMonth: string;
  expYear: string;
  billingName: string;
  billingAddress: ProductionBillingAddress;
}

export interface ProductionSubscriptionEvent {
  id: number;
  eventType:
    | 'activated' | 'tier_changed' | 'scheduled_cancel' | 'resumed' | 'expired'
    | 'canceled' | 'plan_decision_none' | 'scheduled_tier_change'
    | 'scheduled_tier_change_canceled' | 'tos_accepted' | 'payment_method_updated'
    | 'period_end_changed' | 'refund_issued' | 'manual_charge_edited'
    | 'manual_charge_deleted' | 'epd_reconciled' | 'epd_webhook_received';
  fromTier?: Nullable<MembershipTier>;
  toTier?: Nullable<MembershipTier>;
  source: 'self' | 'admin' | 'system';
  occurredAt: string;
}

export interface ProductionMembership {
  isMember: boolean;
  tier: Nullable<MembershipTier>;
  status?: Nullable<'active' | 'canceled' | 'expired' | 'pending_payment'>;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart?: Nullable<string>;
  currentPeriodEnd?: Nullable<string>;
  startedAt?: Nullable<string>;
  canceledAt?: Nullable<string>;
  paymentStatus?: Nullable<'none' | 'pending' | 'succeeded' | 'failed'>;
  paymentMethod?: Nullable<ProductionPaymentMethodOnFile>;
  scheduledTierChange?: Nullable<{ to: MembershipTier; at: string }>;
  recentEvents: ProductionSubscriptionEvent[];
  lastPaidAmountCents?: Nullable<number>;
  lastDiscountPercent?: Nullable<number>;
  metaPurchase?: Nullable<{ eventId: string; valueCents?: Nullable<number>; currency: string }>;
}

export interface ProductionTripLegSummary {
  id: number;
  originAirport: string;
  destinationAirport: string;
  originCity: Nullable<string>;
  destinationCity: Nullable<string>;
  departureTime: string;
  arrivalTime: Nullable<string>;
  tailNumber: Nullable<string>;
  aircraftType: Nullable<string>;
  originFboName: Nullable<string>;
  originFboAddress: Nullable<string>;
  destinationFboName: Nullable<string>;
  destinationFboAddress: Nullable<string>;
  queueClosesAt: Nullable<string>;
}

export type ProductionTripRemainingStep = 'confirmed' | 'fboVerified' | 'manifestAck' | 'policyAck';

export interface ProductionTripChecklist {
  emptyLegId: number;
  confirmedAt: Nullable<string>;
  fboVerifiedAt: Nullable<string>;
  manifestAckAt: Nullable<string>;
  policyAckAt: Nullable<string>;
  passLinkSentAt: Nullable<string>;
  manifestLockedAt: Nullable<string>;
  manifestLocked: boolean;
  boardingPassUrl: Nullable<string>;
  remainingSteps: ProductionTripRemainingStep[];
  passengerCount: number;
  awarded: boolean;
}

export interface ProductionTrip {
  leg: ProductionTripLegSummary;
  checklist: ProductionTripChecklist;
}

export interface ProductionTrips {
  current: ProductionTrip[];
  past: ProductionTrip[];
}

export interface ProductionQueueEntry {
  emptyLegId: number;
  joinedAt: string;
  position: number;
  queueCount: number;
  memberQueueCount: number;
  userInQueue: boolean;
  userTier: 'free' | 'base' | 'plus';
  userHasLineSkip: boolean;
  userHasInternationalPass: boolean;
}

export interface ProductionQueueStatus {
  emptyLegId: number;
  queueCount: number;
  memberQueueCount: number;
  userInQueue: boolean;
  lockedForFreeUsers: boolean;
}

export interface ProductionPublicQueueEntry {
  position: number;
  initials: string;
  tier: 'free' | 'base' | 'plus';
  hasLineSkip: boolean;
  isViewer: boolean;
}

export interface JoinProductionQueueRequest {
  internationalPassAuthorized?: boolean;
  useInternationalPassCredit?: boolean;
}

export interface PurchaseProductionLineSkipRequest {
  useCredit?: boolean;
}

export interface ProductionPassenger {
  id: number;
  emptyLegId: number;
  fullName: string;
  firstName: string;
  middleName?: Nullable<string>;
  lastName: string;
  /** Whole pounds, matching the production passenger contract. */
  weight: Nullable<number>;
  isAccountHolder: boolean;
  gender: Nullable<UserGender>;
  dob: string;
  notes?: Nullable<string>;
  createdAt: string;
}

export interface ProductionPet {
  id: number;
  emptyLegId: number;
  breed: string;
  /** Whole pounds, matching the production pet contract. */
  weight: number;
  createdAt: string;
}

export interface ProductionEmptyLegPassengerList {
  passengers: ProductionPassenger[];
  passengerCap: number;
  pets: ProductionPet[];
}

/** Used by both POST and PATCH: all required fields must be sent on either. */
export interface ProductionPassengerInput {
  firstName: string;
  middleName?: Nullable<string>;
  lastName: string;
  weight: number;
  gender: UserGender;
  dob: string;
  notes?: Nullable<string>;
}

export interface ProductionPetInput {
  breed: string;
  weight: number;
}

export interface UpdateProductionPassengerWeightRequest {
  weight: number;
}

export interface ProductionPhoneVerificationStartResult {
  ok: boolean;
  cooldownSeconds: number;
}

export interface ProductionPhoneVerificationStatus {
  method: 'pin' | 'legacy_reply';
  expiresAt: Nullable<string>;
  cooldownSeconds: number;
  status: 'pending' | 'verified' | 'expired' | 'none';
  clerkWarning: Nullable<string>;
  profile: Nullable<ProductionPhoneVerifiedProfile>;
}

export interface ProductionEmptyLeg {
  id: number;
  originAirport: string;
  destinationAirport: string;
  departureTime: string;
  isInternational: boolean;
  status: 'pending' | 'published' | 'cancelled';
  pricePerHour: number;
  queueCount: number;
  memberQueueCount: number;
  userInQueue: boolean;
  lockedForFreeUsers: boolean;
  lineSkipPriceUsd: number;
  lineSkipSold: boolean;
  viewerHasLineSkip: boolean;
  internationalPassPriceUsd: number;
  internationalPassRequired: boolean;
  viewerHasInternationalPass: boolean;
  viewerIsEffectiveWinner: boolean;
  changeFlagSeverity: 'none' | 'caution' | 'alert';
  aircraftGalleryUrls: string[];
  aircraftGalleryAlts: Array<Nullable<string>>;
  createdAt: string;
  updatedAt: string;
  publicationHoldReason?: Nullable<string>;
  publicationReleaseAt?: Nullable<string>;
  publicationDistanceNm?: Nullable<number>;
  publicationScheduled?: boolean;
  tripId?: Nullable<string>;
  icsUid?: Nullable<string>;
  originCity?: Nullable<string>;
  originTz?: Nullable<string>;
  destinationCity?: Nullable<string>;
  destinationTz?: Nullable<string>;
  arrivalTime?: Nullable<string>;
  manualSchedule?: boolean;
  queueClosesAt?: Nullable<string>;
  aircraftType?: Nullable<string>;
  tailNumber?: Nullable<string>;
  aircraftTypeName?: Nullable<string>;
  aircraftTypeCode?: Nullable<string>;
  aircraftTailPhotoSlot?: Nullable<'exterior_1' | 'exterior_2' | 'exterior_3'>;
  aircraftTailUploadedSlots?: Nullable<Array<'exterior_1' | 'exterior_2' | 'exterior_3' | 'interior'>>;
  durationHours?: Nullable<number>;
  totalPrice?: Nullable<number>;
  msrpUsd?: Nullable<number>;
  msrpFetchedAt?: Nullable<string>;
  changeFlagSummary?: Nullable<string>;
  changeFlagDetails?: Nullable<Record<string, unknown>>;
  lastCheckedAt?: Nullable<string>;
  flaggedAt?: Nullable<string>;
  viewerQueuePosition?: Nullable<number>;
  viewerIsBookedPassenger?: boolean;
  viewerConfirmationStatus?: Nullable<'pending' | 'confirmed' | 'declined'>;
  awardedToClerkUserId?: Nullable<string>;
  awardedAt?: Nullable<string>;
  winnerDisplayName?: Nullable<string>;
  winnerConfirmationStatus?: Nullable<'pending' | 'confirmed' | 'declined'>;
  originFboName?: Nullable<string>;
  originFboAddress?: Nullable<string>;
  destinationFboName?: Nullable<string>;
  destinationFboAddress?: Nullable<string>;
  isProtected?: boolean;
  suppressPublishNotifications?: boolean;
  cancelledAt?: Nullable<string>;
  cancellationReason?: Nullable<string>;
  cancelledByClerkUserId?: Nullable<string>;
  cancelledByKind?: Nullable<'admin' | 'system'>;
  rawSummary?: Nullable<string>;
  notes?: Nullable<string>;
  photoKey?: Nullable<'photo1' | 'photo2' | 'photo3' | 'photo4' | 'photo5'>;
  aircraftTypeId?: Nullable<number>;
}

export class ProductionAuthRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'token'
      | 'network'
      | 'timeout'
      | 'cancelled'
      | 'http'
      | 'session_expired'
      | 'invalid_json'
      | 'invalid_schema',
  ) {
    super(message);
    this.name = 'ProductionAuthRequestError';
  }
}

export class ProductionAuthHttpError extends ProductionAuthRequestError {
  constructor(readonly status: number) {
    super(
      `Authenticated Main API request failed (HTTP ${status}).`,
      status === 401 ? 'session_expired' : 'http',
    );
    this.name = 'ProductionAuthHttpError';
  }
}

export class ProductionAuthTimeoutError extends ProductionAuthRequestError {
  constructor(readonly timeoutMs: number) {
    super(`Authenticated Main API request timed out after ${timeoutMs} ms.`, 'timeout');
    this.name = 'ProductionAuthTimeoutError';
  }
}

export class ProductionAuthCancelledError extends ProductionAuthRequestError {
  constructor() {
    super('Authenticated Main API request was cancelled.', 'cancelled');
    this.name = 'ProductionAuthCancelledError';
  }
}

export class ProductionAuthNetworkError extends ProductionAuthRequestError {
  constructor() {
    super('Authenticated Main API request could not reach the service.', 'network');
    this.name = 'ProductionAuthNetworkError';
  }
}

export class ProductionAuthInvalidJsonError extends ProductionAuthRequestError {
  constructor() {
    super('Authenticated production response was not valid JSON.', 'invalid_json');
    this.name = 'ProductionAuthInvalidJsonError';
  }
}

export class ProductionAuthSchemaError extends ProductionAuthRequestError {
  constructor(readonly field: string) {
    super(`Authenticated production response did not match the API contract (${field}).`, 'invalid_schema');
    this.name = 'ProductionAuthSchemaError';
  }
}

export const PRODUCTION_AUTH_TIMEOUT_MS = 10_000;
export const PRODUCTION_AUTH_PATHS = {
  me: '/me',
  profile: '/me/profile',
  membership: '/membership',
  trips: '/trips',
  phoneVerificationStart: '/me/phone-verification/start',
  phoneVerificationCheck: '/me/phone-verification/check',
} as const;

type Validator<T> = (value: unknown) => T;

function schemaFailure(field: string): never {
  throw new TypeError(field);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return schemaFailure(field);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') return schemaFailure(field);
  return value;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return schemaFailure(field);
  return value;
}

function integerValue(value: unknown, field: string): number {
  const result = numberValue(value, field);
  if (!Number.isSafeInteger(result)) return schemaFailure(field);
  return result;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return schemaFailure(field);
  return value;
}

function nullable<T>(value: unknown, field: string, parse: (item: unknown, path: string) => T): T | null {
  return value === null ? null : parse(value, field);
}

function optional<T>(
  raw: Record<string, unknown>,
  key: string,
  field: string,
  parse: (item: unknown, path: string) => T,
): T | undefined {
  return raw[key] === undefined ? undefined : parse(raw[key], `${field}.${key}`);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return schemaFailure(field);
  return value as T;
}

function nullableEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T | null {
  return value === null ? null : enumValue(value, values, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return schemaFailure(field);
  return value.map((item, index) => stringValue(item, `${field}[${index}]`));
}

function numberArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) return schemaFailure(field);
  return value.map((item, index) => numberValue(item, `${field}[${index}]`));
}

function dateOnly(value: unknown, field: string): string {
  const date = stringValue(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return schemaFailure(field);
  return date;
}

function parseImpersonation(value: unknown, field: string): ProductionImpersonation {
  const raw = objectValue(value, field);
  return {
    active: booleanValue(raw.active, `${field}.active`),
    adminClerkUserId: stringValue(raw.adminClerkUserId, `${field}.adminClerkUserId`),
    adminEmail: nullable(raw.adminEmail, `${field}.adminEmail`, stringValue),
    targetClerkUserId: stringValue(raw.targetClerkUserId, `${field}.targetClerkUserId`),
    targetEmail: nullable(raw.targetEmail, `${field}.targetEmail`, stringValue),
    targetName: nullable(raw.targetName, `${field}.targetName`, stringValue),
  };
}

function parseCurrentUser(value: unknown): ProductionCurrentUser {
  const raw = objectValue(value, 'currentUser');
  const result: ProductionCurrentUser = {
    isAuthenticated: booleanValue(raw.isAuthenticated, 'currentUser.isAuthenticated'),
    isAdmin: booleanValue(raw.isAdmin, 'currentUser.isAdmin'),
    isConcierge: booleanValue(raw.isConcierge, 'currentUser.isConcierge'),
    isMember: booleanValue(raw.isMember, 'currentUser.isMember'),
    memberTier: nullableEnum(raw.memberTier, ['base', 'plus'] as const, 'currentUser.memberTier'),
    isProfileComplete: booleanValue(raw.isProfileComplete, 'currentUser.isProfileComplete'),
    needsPlanDecision: booleanValue(raw.needsPlanDecision, 'currentUser.needsPlanDecision'),
    needsSignupPhone: booleanValue(raw.needsSignupPhone, 'currentUser.needsSignupPhone'),
  };
  for (const key of ['email', 'firstName', 'lastName'] as const) {
    const parsed = optional(raw, key, 'currentUser', (item, field) =>
      nullable(item, field, stringValue));
    if (parsed !== undefined) result[key] = parsed;
  }
  if (raw.impersonation !== undefined) {
    result.impersonation = raw.impersonation === null
      ? null
      : parseImpersonation(raw.impersonation, 'currentUser.impersonation');
  }
  // /api/me can return HTTP 200 for anonymous sessions and caught identity
  // failures. Preserve the projection as-is; resolution is handled separately.
  return result;
}

function parseNotificationPrefs(value: unknown, field: string): ProductionNotificationPrefs {
  const raw = objectValue(value, field);
  const channel = (item: unknown, path: string) =>
    nullable(item, path, (entry, innerPath) =>
      enumValue(entry, ['email', 'sms', 'both'] as const, innerPath));
  const mode = enumValue(raw.mode, ['off', 'all', 'specific'] as const, `${field}.mode`);
  return {
    mode,
    allChannels: channel(raw.allChannels, `${field}.allChannels`),
    emptyLegHomeAirport: channel(raw.emptyLegHomeAirport, `${field}.emptyLegHomeAirport`),
    departingFavorite: channel(raw.departingFavorite, `${field}.departingFavorite`),
    arrivingFavorite: channel(raw.arrivingFavorite, `${field}.arrivingFavorite`),
    queueUpdates: enumValue(raw.queueUpdates, ['email', 'sms', 'both'] as const, `${field}.queueUpdates`),
    winningNotifications: enumValue(raw.winningNotifications, ['email', 'sms', 'both'] as const, `${field}.winningNotifications`),
  };
}

function parseCreditBalances(value: unknown, field: string): ProductionUpgradeCreditBalances {
  const raw = objectValue(value, field);
  const skipTheLine = integerValue(raw.skipTheLine, `${field}.skipTheLine`);
  const internationalPass = integerValue(raw.internationalPass, `${field}.internationalPass`);
  if (skipTheLine < 0 || internationalPass < 0) return schemaFailure(field);
  return {
    skipTheLine,
    internationalPass,
  };
}

function parseProfileShape(value: unknown, field: string, verifiedPhoneProjection: boolean): ProductionUserProfile | ProductionPhoneVerifiedProfile {
  const raw = objectValue(value, field);
  const gender = nullableEnum(raw.gender, ['male', 'female'] as const, `${field}.gender`);
  const signupChannel = nullableEnum(raw.signupChannel, ['phone', 'email'] as const, `${field}.signupChannel`);
  const profile: ProductionUserProfile = {
    firstName: nullable(raw.firstName, `${field}.firstName`, stringValue),
    lastName: nullable(raw.lastName, `${field}.lastName`, stringValue),
    dob: nullable(raw.dob, `${field}.dob`, dateOnly),
    gender,
    homeAirportCode: nullable(raw.homeAirportCode, `${field}.homeAirportCode`, stringValue),
    homeAirportLabel: nullable(raw.homeAirportLabel, `${field}.homeAirportLabel`, stringValue),
    favoriteAirportCodes: stringArray(raw.favoriteAirportCodes, `${field}.favoriteAirportCodes`),
    favoriteAirportLabels: stringArray(raw.favoriteAirportLabels, `${field}.favoriteAirportLabels`),
    favoriteCityKeys: stringArray(raw.favoriteCityKeys, `${field}.favoriteCityKeys`),
    favoriteCityLabels: stringArray(raw.favoriteCityLabels, `${field}.favoriteCityLabels`),
    phoneE164: nullable(raw.phoneE164, `${field}.phoneE164`, stringValue),
    phoneCountry: nullable(raw.phoneCountry, `${field}.phoneCountry`, stringValue),
    phoneVerifiedAt: nullable(raw.phoneVerifiedAt, `${field}.phoneVerifiedAt`, stringValue),
    phoneVerificationRequired: booleanValue(raw.phoneVerificationRequired, `${field}.phoneVerificationRequired`),
    notificationPrefs: parseNotificationPrefs(raw.notificationPrefs, `${field}.notificationPrefs`),
    smsConsent: booleanValue(raw.smsConsent, `${field}.smsConsent`),
    smsConsentAt: nullable(raw.smsConsentAt, `${field}.smsConsentAt`, stringValue),
    smsConsentRevokedAt: nullable(raw.smsConsentRevokedAt, `${field}.smsConsentRevokedAt`, stringValue),
    email: nullable(raw.email, `${field}.email`, stringValue),
    emailLocked: booleanValue(raw.emailLocked, `${field}.emailLocked`),
    signupChannel,
    isComplete: booleanValue(raw.isComplete, `${field}.isComplete`),
    weightLbs: nullable(raw.weightLbs, `${field}.weightLbs`, (item, path) => {
      const weight = integerValue(item, path);
      if (weight < 1 || weight > 1500) return schemaFailure(path);
      return weight;
    }),
  } as ProductionUserProfile;
  if (verifiedPhoneProjection) {
    profile.updatedAt = nullable(raw.updatedAt, `${field}.updatedAt`, stringValue);
    return profile as ProductionPhoneVerifiedProfile;
  }
  profile.upgradeCreditBalances = parseCreditBalances(raw.upgradeCreditBalances, `${field}.upgradeCreditBalances`);
  const updatedAt = optional(raw, 'updatedAt', field, (item, path) => nullable(item, path, stringValue));
  if (updatedAt !== undefined) profile.updatedAt = updatedAt;
  return profile;
}

function parseProfile(value: unknown): ProductionUserProfile {
  return parseProfileShape(value, 'profile', false) as ProductionUserProfile;
}

function parsePhoneVerifiedProfile(value: unknown): ProductionPhoneVerifiedProfile {
  return parseProfileShape(value, 'phoneVerification.profile', true) as ProductionPhoneVerifiedProfile;
}

function validateProfileUpdate(data: UpdateProductionUserProfileRequest): void {
  if (!data || typeof data !== 'object') schemaFailure('updateProfile.body');
  for (const [key, value, max] of [
    ['firstName', data.firstName, 80],
    ['lastName', data.lastName, 80],
  ] as const) {
    if (typeof value !== 'string' || value.length < 1 || value.length > max) schemaFailure(`updateProfile.${key}`);
  }
  dateOnly(data.dob, 'updateProfile.dob');
  enumValue(data.gender, ['male', 'female'] as const, 'updateProfile.gender');
  if (typeof data.homeAirportCode !== 'string' || ![3, 4].includes(data.homeAirportCode.length)) {
    schemaFailure('updateProfile.homeAirportCode');
  }
  if (!Array.isArray(data.favoriteCityKeys) || data.favoriteCityKeys.length < 1 ||
      data.favoriteCityKeys.some((key) => typeof key !== 'string' || key.length < 1 || key.length > 64)) {
    schemaFailure('updateProfile.favoriteCityKeys');
  }
  if (data.phoneE164 !== undefined && data.phoneE164 !== null && typeof data.phoneE164 !== 'string') schemaFailure('updateProfile.phoneE164');
  if (data.phoneCountry !== undefined && data.phoneCountry !== null && typeof data.phoneCountry !== 'string') schemaFailure('updateProfile.phoneCountry');
  if (data.phoneE164 !== undefined && data.phoneE164 !== null &&
      (data.phoneCountry === undefined || data.phoneCountry === null)) schemaFailure('updateProfile.phoneCountry');
  if (data.notificationPrefs !== undefined) parseNotificationPrefs(data.notificationPrefs, 'updateProfile.notificationPrefs');
  if (data.smsConsent !== undefined) booleanValue(data.smsConsent, 'updateProfile.smsConsent');
  if (data.email !== undefined && (typeof data.email !== 'string' || data.email.length < 3 || data.email.length > 254 || !/^\S+@\S+\.\S+$/.test(data.email))) {
    schemaFailure('updateProfile.email');
  }
  if (data.weightLbs !== undefined && data.weightLbs !== null &&
      (!Number.isSafeInteger(data.weightLbs) || data.weightLbs < 1 || data.weightLbs > 1500)) {
    schemaFailure('updateProfile.weightLbs');
  }
}

function parseBillingAddress(value: unknown, field: string): ProductionBillingAddress {
  const raw = objectValue(value, field);
  const line2 = optional(raw, 'line2', field, (item, path) => nullable(item, path, stringValue));
  return {
    line1: stringValue(raw.line1, `${field}.line1`),
    ...(line2 === undefined ? {} : { line2 }),
    city: stringValue(raw.city, `${field}.city`),
    region: stringValue(raw.region, `${field}.region`),
    postalCode: stringValue(raw.postalCode, `${field}.postalCode`),
    country: stringValue(raw.country, `${field}.country`),
  };
}

function parsePaymentMethod(value: unknown, field: string): ProductionPaymentMethodOnFile {
  const raw = objectValue(value, field);
  return {
    brand: enumValue(raw.brand, ['visa', 'mastercard', 'amex', 'discover', 'diners', 'jcb', 'unionpay', 'unknown'] as const, `${field}.brand`),
    last4: stringValue(raw.last4, `${field}.last4`),
    expMonth: stringValue(raw.expMonth, `${field}.expMonth`),
    expYear: stringValue(raw.expYear, `${field}.expYear`),
    billingName: stringValue(raw.billingName, `${field}.billingName`),
    billingAddress: parseBillingAddress(raw.billingAddress, `${field}.billingAddress`),
  };
}

const subscriptionEventTypes = [
  'activated', 'tier_changed', 'scheduled_cancel', 'resumed', 'expired', 'canceled',
  'plan_decision_none', 'scheduled_tier_change', 'scheduled_tier_change_canceled',
  'tos_accepted', 'payment_method_updated', 'period_end_changed', 'refund_issued',
  'manual_charge_edited', 'manual_charge_deleted', 'epd_reconciled', 'epd_webhook_received',
] as const;

function parseSubscriptionEvent(value: unknown, field: string): ProductionSubscriptionEvent {
  const raw = objectValue(value, field);
  const fromTier = optional(raw, 'fromTier', field, (item, path) => nullableEnum(item, ['base', 'plus'] as const, path));
  const toTier = optional(raw, 'toTier', field, (item, path) => nullableEnum(item, ['base', 'plus'] as const, path));
  return {
    id: integerValue(raw.id, `${field}.id`),
    eventType: enumValue(raw.eventType, subscriptionEventTypes, `${field}.eventType`),
    ...(fromTier === undefined ? {} : { fromTier }),
    ...(toTier === undefined ? {} : { toTier }),
    source: enumValue(raw.source, ['self', 'admin', 'system'] as const, `${field}.source`),
    occurredAt: stringValue(raw.occurredAt, `${field}.occurredAt`),
  };
}

function parseMembership(value: unknown): ProductionMembership {
  const raw = objectValue(value, 'membership');
  if (!Array.isArray(raw.recentEvents)) schemaFailure('membership.recentEvents');
  const result: ProductionMembership = {
    isMember: booleanValue(raw.isMember, 'membership.isMember'),
    tier: nullableEnum(raw.tier, ['base', 'plus'] as const, 'membership.tier'),
    cancelAtPeriodEnd: booleanValue(raw.cancelAtPeriodEnd, 'membership.cancelAtPeriodEnd'),
    recentEvents: raw.recentEvents.map((item, index) => parseSubscriptionEvent(item, `membership.recentEvents[${index}]`)),
  };
  const status = optional(raw, 'status', 'membership', (item, field) =>
    nullableEnum(item, ['active', 'canceled', 'expired', 'pending_payment'] as const, field));
  if (status !== undefined) result.status = status;
  const paymentStatus = optional(raw, 'paymentStatus', 'membership', (item, field) =>
    nullableEnum(item, ['none', 'pending', 'succeeded', 'failed'] as const, field));
  if (paymentStatus !== undefined) result.paymentStatus = paymentStatus;
  for (const key of ['currentPeriodStart', 'currentPeriodEnd', 'startedAt', 'canceledAt'] as const) {
    const parsed = optional(raw, key, 'membership', (item, field) => nullable(item, field, stringValue));
    if (parsed !== undefined) result[key] = parsed;
  }
  const paymentMethod = optional(raw, 'paymentMethod', 'membership', (item, field) =>
    nullable(item, field, parsePaymentMethod));
  if (paymentMethod !== undefined) result.paymentMethod = paymentMethod;
  const scheduledTierChange = optional(raw, 'scheduledTierChange', 'membership', (item, field) => {
    if (item === null) return null;
    const change = objectValue(item, field);
    return {
      to: enumValue(change.to, ['base', 'plus'] as const, `${field}.to`),
      at: stringValue(change.at, `${field}.at`),
    };
  });
  if (scheduledTierChange !== undefined) result.scheduledTierChange = scheduledTierChange;
  for (const key of ['lastPaidAmountCents', 'lastDiscountPercent'] as const) {
    const parsed = optional(raw, key, 'membership', (item, field) => nullable(item, field, integerValue));
    if (parsed !== undefined) result[key] = parsed;
  }
  const metaPurchase = optional(raw, 'metaPurchase', 'membership', (item, field) => {
    if (item === null) return null;
    const purchase = objectValue(item, field);
    const valueCents = optional(purchase, 'valueCents', field, (entry, path) => nullable(entry, path, integerValue));
    return {
      eventId: stringValue(purchase.eventId, `${field}.eventId`),
      ...(valueCents === undefined ? {} : { valueCents }),
      currency: stringValue(purchase.currency, `${field}.currency`),
    };
  });
  if (metaPurchase !== undefined) result.metaPurchase = metaPurchase;
  return result;
}

function parseTripLeg(value: unknown, field: string): ProductionTripLegSummary {
  const raw = objectValue(value, field);
  return {
    id: integerValue(raw.id, `${field}.id`),
    originAirport: stringValue(raw.originAirport, `${field}.originAirport`),
    destinationAirport: stringValue(raw.destinationAirport, `${field}.destinationAirport`),
    originCity: nullable(raw.originCity, `${field}.originCity`, stringValue),
    destinationCity: nullable(raw.destinationCity, `${field}.destinationCity`, stringValue),
    departureTime: stringValue(raw.departureTime, `${field}.departureTime`),
    arrivalTime: nullable(raw.arrivalTime, `${field}.arrivalTime`, stringValue),
    tailNumber: nullable(raw.tailNumber, `${field}.tailNumber`, stringValue),
    aircraftType: nullable(raw.aircraftType, `${field}.aircraftType`, stringValue),
    originFboName: nullable(raw.originFboName, `${field}.originFboName`, stringValue),
    originFboAddress: nullable(raw.originFboAddress, `${field}.originFboAddress`, stringValue),
    destinationFboName: nullable(raw.destinationFboName, `${field}.destinationFboName`, stringValue),
    destinationFboAddress: nullable(raw.destinationFboAddress, `${field}.destinationFboAddress`, stringValue),
    queueClosesAt: nullable(raw.queueClosesAt, `${field}.queueClosesAt`, stringValue),
  };
}

function parseTripChecklist(value: unknown, field: string): ProductionTripChecklist {
  const raw = objectValue(value, field);
  if (!Array.isArray(raw.remainingSteps)) schemaFailure(`${field}.remainingSteps`);
  return {
    emptyLegId: integerValue(raw.emptyLegId, `${field}.emptyLegId`),
    confirmedAt: nullable(raw.confirmedAt, `${field}.confirmedAt`, stringValue),
    fboVerifiedAt: nullable(raw.fboVerifiedAt, `${field}.fboVerifiedAt`, stringValue),
    manifestAckAt: nullable(raw.manifestAckAt, `${field}.manifestAckAt`, stringValue),
    policyAckAt: nullable(raw.policyAckAt, `${field}.policyAckAt`, stringValue),
    passLinkSentAt: nullable(raw.passLinkSentAt, `${field}.passLinkSentAt`, stringValue),
    manifestLockedAt: nullable(raw.manifestLockedAt, `${field}.manifestLockedAt`, stringValue),
    manifestLocked: booleanValue(raw.manifestLocked, `${field}.manifestLocked`),
    boardingPassUrl: nullable(raw.boardingPassUrl, `${field}.boardingPassUrl`, stringValue),
    remainingSteps: raw.remainingSteps.map((step, index) =>
      enumValue(step, ['confirmed', 'fboVerified', 'manifestAck', 'policyAck'] as const, `${field}.remainingSteps[${index}]`)),
    passengerCount: integerValue(raw.passengerCount, `${field}.passengerCount`),
    awarded: booleanValue(raw.awarded, `${field}.awarded`),
  };
}

function parseTrip(value: unknown, field: string): ProductionTrip {
  const raw = objectValue(value, field);
  return {
    leg: parseTripLeg(raw.leg, `${field}.leg`),
    checklist: parseTripChecklist(raw.checklist, `${field}.checklist`),
  };
}

function parseTrips(value: unknown): ProductionTrips {
  const raw = objectValue(value, 'trips');
  if (!Array.isArray(raw.current) || !Array.isArray(raw.past)) schemaFailure('trips.current/past');
  return {
    current: raw.current.map((item, index) => parseTrip(item, `trips.current[${index}]`)),
    past: raw.past.map((item, index) => parseTrip(item, `trips.past[${index}]`)),
  };
}

function parseQueueEntry(value: unknown, field: string): ProductionQueueEntry {
  const raw = objectValue(value, field);
  return {
    emptyLegId: integerValue(raw.emptyLegId, `${field}.emptyLegId`),
    joinedAt: stringValue(raw.joinedAt, `${field}.joinedAt`),
    position: integerValue(raw.position, `${field}.position`),
    queueCount: integerValue(raw.queueCount, `${field}.queueCount`),
    memberQueueCount: integerValue(raw.memberQueueCount, `${field}.memberQueueCount`),
    userInQueue: booleanValue(raw.userInQueue, `${field}.userInQueue`),
    userTier: enumValue(raw.userTier, ['free', 'base', 'plus'] as const, `${field}.userTier`),
    userHasLineSkip: booleanValue(raw.userHasLineSkip, `${field}.userHasLineSkip`),
    userHasInternationalPass: booleanValue(raw.userHasInternationalPass, `${field}.userHasInternationalPass`),
  };
}

function parseQueueStatus(value: unknown): ProductionQueueStatus {
  const raw = objectValue(value, 'queueStatus');
  return {
    emptyLegId: integerValue(raw.emptyLegId, 'queueStatus.emptyLegId'),
    queueCount: integerValue(raw.queueCount, 'queueStatus.queueCount'),
    memberQueueCount: integerValue(raw.memberQueueCount, 'queueStatus.memberQueueCount'),
    userInQueue: booleanValue(raw.userInQueue, 'queueStatus.userInQueue'),
    lockedForFreeUsers: booleanValue(raw.lockedForFreeUsers, 'queueStatus.lockedForFreeUsers'),
  };
}

function parsePublicQueueEntry(value: unknown, field: string): ProductionPublicQueueEntry {
  const raw = objectValue(value, field);
  return {
    position: integerValue(raw.position, `${field}.position`),
    initials: stringValue(raw.initials, `${field}.initials`),
    tier: enumValue(raw.tier, ['free', 'base', 'plus'] as const, `${field}.tier`),
    hasLineSkip: booleanValue(raw.hasLineSkip, `${field}.hasLineSkip`),
    isViewer: booleanValue(raw.isViewer, `${field}.isViewer`),
  };
}

function parsePassenger(value: unknown, field: string): ProductionPassenger {
  const raw = objectValue(value, field);
  const middleName = optional(raw, 'middleName', field, (item, path) => nullable(item, path, stringValue));
  const notes = optional(raw, 'notes', field, (item, path) => nullable(item, path, stringValue));
  return {
    id: integerValue(raw.id, `${field}.id`),
    emptyLegId: integerValue(raw.emptyLegId, `${field}.emptyLegId`),
    fullName: stringValue(raw.fullName, `${field}.fullName`),
    firstName: stringValue(raw.firstName, `${field}.firstName`),
    ...(middleName === undefined ? {} : { middleName }),
    lastName: stringValue(raw.lastName, `${field}.lastName`),
    weight: nullable(raw.weight, `${field}.weight`, integerValue),
    isAccountHolder: booleanValue(raw.isAccountHolder, `${field}.isAccountHolder`),
    gender: nullableEnum(raw.gender, ['male', 'female'] as const, `${field}.gender`),
    dob: dateOnly(raw.dob, `${field}.dob`),
    ...(notes === undefined ? {} : { notes }),
    createdAt: stringValue(raw.createdAt, `${field}.createdAt`),
  };
}

function parsePet(value: unknown, field: string): ProductionPet {
  const raw = objectValue(value, field);
  return {
    id: integerValue(raw.id, `${field}.id`),
    emptyLegId: integerValue(raw.emptyLegId, `${field}.emptyLegId`),
    breed: stringValue(raw.breed, `${field}.breed`),
    weight: integerValue(raw.weight, `${field}.weight`),
    createdAt: stringValue(raw.createdAt, `${field}.createdAt`),
  };
}

function parseEmptyLegPassengerList(value: unknown): ProductionEmptyLegPassengerList {
  const raw = objectValue(value, 'emptyLegPassengers');
  if (!Array.isArray(raw.passengers) || !Array.isArray(raw.pets)) schemaFailure('emptyLegPassengers.passengers/pets');
  return {
    passengers: raw.passengers.map((item, index) => parsePassenger(item, `emptyLegPassengers.passengers[${index}]`)),
    passengerCap: integerValue(raw.passengerCap, 'emptyLegPassengers.passengerCap'),
    pets: raw.pets.map((item, index) => parsePet(item, `emptyLegPassengers.pets[${index}]`)),
  };
}

function validatePassengerInput(data: ProductionPassengerInput, field: string): void {
  if (!data || typeof data !== 'object') schemaFailure(`${field}.body`);
  for (const key of ['firstName', 'lastName'] as const) {
    const value = data[key];
    if (typeof value !== 'string' || value.length < 1 || value.length > 100) schemaFailure(`${field}.${key}`);
  }
  if (data.middleName !== undefined && data.middleName !== null &&
      (typeof data.middleName !== 'string' || data.middleName.length > 100)) schemaFailure(`${field}.middleName`);
  if (!Number.isSafeInteger(data.weight) || data.weight < 1 || data.weight > 1000) schemaFailure(`${field}.weight`);
  enumValue(data.gender, ['male', 'female'] as const, `${field}.gender`);
  dateOnly(data.dob, `${field}.dob`);
  if (data.notes !== undefined && data.notes !== null &&
      (typeof data.notes !== 'string' || data.notes.length > 500)) schemaFailure(`${field}.notes`);
}

function validatePetInput(data: ProductionPetInput, field: string): void {
  if (!data || typeof data !== 'object' || typeof data.breed !== 'string' ||
      data.breed.length < 1 || data.breed.length > 100 ||
      !Number.isSafeInteger(data.weight) || data.weight < 1 || data.weight > 1000) {
    schemaFailure(`${field}.body`);
  }
}

function validateQueueJoin(data: JoinProductionQueueRequest): void {
  if (!data || typeof data !== 'object') schemaFailure('joinQueue.body');
  for (const key of ['internationalPassAuthorized', 'useInternationalPassCredit'] as const) {
    if (data[key] !== undefined) booleanValue(data[key], `joinQueue.${key}`);
  }
}

function validateSkipLine(data: PurchaseProductionLineSkipRequest): void {
  if (!data || typeof data !== 'object') schemaFailure('skipLine.body');
  if (data.useCredit !== undefined) booleanValue(data.useCredit, 'skipLine.useCredit');
}

function parseEmptyLeg(value: unknown): ProductionEmptyLeg {
  const raw = objectValue(value, 'emptyLeg');
  // The production schema has many optional projected properties. Validate all
  // declared fields that are present and every required projection, while
  // leaving undeclared properties uninterpreted as the source parser does.
  const required = {
    id: (v: unknown, f: string) => integerValue(v, f),
    originAirport: stringValue,
    destinationAirport: stringValue,
    departureTime: stringValue,
    isInternational: booleanValue,
    status: (v: unknown, f: string) => enumValue(v, ['pending', 'published', 'cancelled'] as const, f),
    pricePerHour: integerValue,
    queueCount: integerValue,
    memberQueueCount: integerValue,
    userInQueue: booleanValue,
    lockedForFreeUsers: booleanValue,
    lineSkipPriceUsd: integerValue,
    lineSkipSold: booleanValue,
    viewerHasLineSkip: booleanValue,
    internationalPassPriceUsd: integerValue,
    internationalPassRequired: booleanValue,
    viewerHasInternationalPass: booleanValue,
    viewerIsEffectiveWinner: booleanValue,
    changeFlagSeverity: (v: unknown, f: string) => enumValue(v, ['none', 'caution', 'alert'] as const, f),
    aircraftGalleryUrls: stringArray,
    aircraftGalleryAlts: (v: unknown, f: string) => {
      if (!Array.isArray(v)) return schemaFailure(f);
      return v.map((item, index) => nullable(item, `${f}[${index}]`, stringValue));
    },
    createdAt: stringValue,
    updatedAt: stringValue,
  } satisfies Record<string, (value: unknown, field: string) => unknown>;
  for (const [key, parse] of Object.entries(required)) parse(raw[key], `emptyLeg.${key}`);
  const optionalChecks: Record<string, (value: unknown, field: string) => unknown> = {
    publicationHoldReason: (v, f) => nullable(v, f, stringValue),
    publicationReleaseAt: (v, f) => nullable(v, f, stringValue),
    publicationDistanceNm: (v, f) => nullable(v, f, numberValue),
    publicationScheduled: booleanValue,
    tripId: (v, f) => nullable(v, f, stringValue),
    icsUid: (v, f) => nullable(v, f, stringValue),
    originCity: (v, f) => nullable(v, f, stringValue),
    originTz: (v, f) => nullable(v, f, stringValue),
    destinationCity: (v, f) => nullable(v, f, stringValue),
    destinationTz: (v, f) => nullable(v, f, stringValue),
    arrivalTime: (v, f) => nullable(v, f, stringValue),
    manualSchedule: booleanValue,
    queueClosesAt: (v, f) => nullable(v, f, stringValue),
    aircraftType: (v, f) => nullable(v, f, stringValue),
    tailNumber: (v, f) => nullable(v, f, stringValue),
    aircraftTypeName: (v, f) => nullable(v, f, stringValue),
    aircraftTypeCode: (v, f) => nullable(v, f, stringValue),
    aircraftTailPhotoSlot: (v, f) => nullable(v, f, (x, p) => enumValue(x, ['exterior_1', 'exterior_2', 'exterior_3'] as const, p)),
    aircraftTailUploadedSlots: (v, f) => nullable(v, f, (x, p) => {
      if (!Array.isArray(x)) return schemaFailure(p);
      return x.map((slot, index) => enumValue(slot, ['exterior_1', 'exterior_2', 'exterior_3', 'interior'] as const, `${p}[${index}]`));
    }),
    durationHours: (v, f) => nullable(v, f, numberValue),
    totalPrice: (v, f) => nullable(v, f, integerValue),
    msrpUsd: (v, f) => nullable(v, f, numberValue),
    msrpFetchedAt: (v, f) => nullable(v, f, stringValue),
    changeFlagSummary: (v, f) => nullable(v, f, stringValue),
    changeFlagDetails: (v, f) => nullable(v, f, objectValue),
    lastCheckedAt: (v, f) => nullable(v, f, stringValue),
    flaggedAt: (v, f) => nullable(v, f, stringValue),
    viewerQueuePosition: (v, f) => nullable(v, f, integerValue),
    viewerIsBookedPassenger: booleanValue,
    viewerConfirmationStatus: (v, f) => nullable(v, f, (x, p) => enumValue(x, ['pending', 'confirmed', 'declined'] as const, p)),
    awardedToClerkUserId: (v, f) => nullable(v, f, stringValue),
    awardedAt: (v, f) => nullable(v, f, stringValue),
    winnerDisplayName: (v, f) => nullable(v, f, stringValue),
    winnerConfirmationStatus: (v, f) => nullable(v, f, (x, p) => enumValue(x, ['pending', 'confirmed', 'declined'] as const, p)),
    originFboName: (v, f) => nullable(v, f, stringValue),
    originFboAddress: (v, f) => nullable(v, f, stringValue),
    destinationFboName: (v, f) => nullable(v, f, stringValue),
    destinationFboAddress: (v, f) => nullable(v, f, stringValue),
    isProtected: booleanValue,
    suppressPublishNotifications: booleanValue,
    cancelledAt: (v, f) => nullable(v, f, stringValue),
    cancellationReason: (v, f) => nullable(v, f, stringValue),
    cancelledByClerkUserId: (v, f) => nullable(v, f, stringValue),
    cancelledByKind: (v, f) => nullable(v, f, (x, p) => enumValue(x, ['admin', 'system'] as const, p)),
    rawSummary: (v, f) => nullable(v, f, stringValue),
    notes: (v, f) => nullable(v, f, stringValue),
    photoKey: (v, f) => nullable(v, f, (x, p) => enumValue(x, ['photo1', 'photo2', 'photo3', 'photo4', 'photo5'] as const, p)),
    aircraftTypeId: (v, f) => nullable(v, f, integerValue),
  };
  for (const [key, parse] of Object.entries(optionalChecks)) {
    if (raw[key] !== undefined) parse(raw[key], `emptyLeg.${key}`);
  }
  return raw as unknown as ProductionEmptyLeg;
}

function parsePhoneVerificationStart(value: unknown): ProductionPhoneVerificationStartResult {
  const raw = objectValue(value, 'phoneVerificationStart');
  return {
    ok: booleanValue(raw.ok, 'phoneVerificationStart.ok'),
    cooldownSeconds: integerValue(raw.cooldownSeconds, 'phoneVerificationStart.cooldownSeconds'),
  };
}

function parsePhoneVerificationStatus(value: unknown): ProductionPhoneVerificationStatus {
  const raw = objectValue(value, 'phoneVerificationStatus');
  return {
    method: enumValue(raw.method, ['pin', 'legacy_reply'] as const, 'phoneVerificationStatus.method'),
    expiresAt: nullable(raw.expiresAt, 'phoneVerificationStatus.expiresAt', stringValue),
    cooldownSeconds: integerValue(raw.cooldownSeconds, 'phoneVerificationStatus.cooldownSeconds'),
    status: enumValue(raw.status, ['pending', 'verified', 'expired', 'none'] as const, 'phoneVerificationStatus.status'),
    clerkWarning: nullable(raw.clerkWarning, 'phoneVerificationStatus.clerkWarning', stringValue),
    profile: nullable(raw.profile, 'phoneVerificationStatus.profile', parsePhoneVerifiedProfile),
  };
}

function validatePhoneE164(phoneE164: string, field: string): void {
  if (typeof phoneE164 !== 'string' || phoneE164.length < 8 || phoneE164.length > 16) schemaFailure(field);
}

function projectRequestBody(
  source: object,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const input = source as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) projected[key] = input[key];
  }
  return projected;
}

function validateLegId(id: number, field: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError(`${field} must be a positive integer.`);
}

function validateNestedId(id: number, field: string): void {
  validateLegId(id, field);
}

/**
 * Construction is inert. No screen creates this client today; every method is
 * explicit, requires the verified provider, and sends requests only on call.
 * GET profile, passenger roster, and phone status may mutate server state.
 */
export function createAuthenticatedProductionApiClient(options: ProductionAuthApiOptions) {
  if (!options.tokenProvider || typeof options.tokenProvider.getVerifiedAccessToken !== 'function') {
    throw new TypeError('A verified production token provider is required.');
  }
  const timeoutMs = options.timeoutMs ?? PRODUCTION_AUTH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Production auth timeout must be a positive finite number.');
  let baseUrl: string;
  try {
    if (
      !options.environment ||
      !options.baseUrl ||
      options.tokenProvider.environment !== options.environment
    ) {
      throw new Error('The selected Main API and Clerk environments must match.');
    }
    const selected = getMainBluebirdApiConfiguration();
    baseUrl = validateMainBluebirdApiBaseUrl(options.baseUrl, options.environment);
    if (
      selected.environment !== options.environment ||
      selected.apiBaseUrl !== baseUrl
    ) {
      throw new Error('Main API client configuration does not match the selected environment.');
    }
    if (
      options.environment === 'development' &&
      !getMainBluebirdDevelopmentDiagnosticStatus().clerkInstanceMatchVerified
    ) {
      throw new Error('The Development API Clerk issuer has not been verified.');
    }
  } catch {
    if (!options.diagnostic) throw new Error('Main Bluebird API configuration is invalid.');
    throw new ProductionAuthConfigurationError();
  }
  if (
    options.diagnostic &&
    options.diagnostic.expectedUrl !== `${baseUrl}${PRODUCTION_AUTH_PATHS.me}`
  ) {
    throw new ProductionAuthConfigurationError();
  }
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(
    path: string,
    method: ProductionHttpMethod,
    validator: Validator<T>,
    requestOptions: ProductionRequestOptions = {},
    body?: unknown,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    if (
      options.diagnostic &&
      url !== options.diagnostic.expectedUrl
    ) {
      throw new ProductionAuthConfigurationError();
    }
    return requestProductionJson({
      url,
      fetcher,
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'omit',
      timeoutMs,
      signal: requestOptions.signal,
      onResponseStatus: requestOptions.onResponseStatus,
      onFetchInitiated: options.diagnostic?.onFetchInitiated,
      onFetchCompleted: options.diagnostic?.onFetchCompleted,
      onFetchFailed: options.diagnostic?.onFetchFailed,
      prepareHeaders: async (signal) => {
        let token: string | null;
        try {
          token = await options.tokenProvider.getVerifiedAccessToken();
        } catch {
          notifyDiagnosticTokenResult(options.diagnostic, false);
          throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
        }
        const tokenObtained = typeof token === 'string' && token.trim().length > 0;
        notifyDiagnosticTokenResult(options.diagnostic, tokenObtained);
        if (signal.aborted) throw new ProductionAuthCancelledError();
        if (!tokenObtained) {
          throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
        }
        if (typeof token !== 'string') {
          throw new ProductionAuthRequestError('Main API access token is invalid.', 'token');
        }
        if (/\s/.test(token)) {
          throw new ProductionAuthRequestError('Main API access token is invalid.', 'token');
        }
        return { Authorization: `Bearer ${token}` };
      },
      parse: validator,
      errors: {
        timeout: (duration) => new ProductionAuthTimeoutError(duration),
        cancelled: () => new ProductionAuthCancelledError(),
        network: () => new ProductionAuthNetworkError(),
        http: (response) => new ProductionAuthHttpError(response.status),
        invalidJson: () => new ProductionAuthInvalidJsonError(),
        schema: (error) => error instanceof ProductionAuthRequestError
          ? error
          : new ProductionAuthSchemaError(error instanceof Error ? error.message : 'response'),
      },
    });
  }

  const emptyLegPath = (id: number) => {
    validateLegId(id, 'emptyLegId');
    return `/empty-legs/${id}`;
  };
  const passengersPath = (id: number) => `${emptyLegPath(id)}/passengers`;
  const phoneStatusPath = (phoneE164: string) => {
    validatePhoneE164(phoneE164, 'phoneE164');
    return `/me/phone-verification/status?phoneE164=${encodeURIComponent(phoneE164)}`;
  };

  return {
    getMe: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.me, 'GET', parseCurrentUser, requestOptions),
    getMeWithStatus: async (
      onResponseStatus?: (status: number) => void,
    ): Promise<ProductionCurrentUserResponse> => {
      let status: number | null = null;
      const currentUser = await request(PRODUCTION_AUTH_PATHS.me, 'GET', parseCurrentUser, {
        onResponseStatus: (responseStatus) => {
          status = responseStatus;
          onResponseStatus?.(responseStatus);
        },
      });
      if (status === null) throw new ProductionAuthRequestError('Main API response status was unavailable.', 'network');
      return { status, currentUser };
    },
    getProfile: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.profile, 'GET', parseProfile, requestOptions),
    updateProfile: (data: UpdateProductionUserProfileRequest, requestOptions?: ProductionRequestOptions) => {
      validateProfileUpdate(data);
      return request(
        PRODUCTION_AUTH_PATHS.profile,
        'PUT',
        parseProfile,
        requestOptions,
        projectRequestBody(data, [
          'firstName', 'lastName', 'dob', 'gender', 'homeAirportCode', 'favoriteCityKeys',
          'phoneE164', 'phoneCountry', 'notificationPrefs', 'smsConsent', 'email', 'weightLbs',
        ]),
      );
    },
    getMembership: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.membership, 'GET', parseMembership, requestOptions),
    listTrips: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.trips, 'GET', parseTrips, requestOptions),
    getEmptyLegQueue: (emptyLegId: number, requestOptions?: ProductionRequestOptions) =>
      request(`${emptyLegPath(emptyLegId)}/queue`, 'GET', (value) => {
        if (!Array.isArray(value)) return schemaFailure('publicQueue');
        return value.map((item, index) => parsePublicQueueEntry(item, `publicQueue[${index}]`));
      }, requestOptions),
    /**
     * Eligibility and ranking stay server-authoritative: complete profile,
     * active membership, published/open leg and one queue entry per local-day
     * family; callers may authorize a pass but cannot choose rank or tier.
     */
    joinEmptyLegQueue: (
      emptyLegId: number,
      data?: JoinProductionQueueRequest,
      requestOptions?: ProductionRequestOptions,
    ) => {
      if (data !== undefined) validateQueueJoin(data);
      return request(
        `${emptyLegPath(emptyLegId)}/queue`,
        'POST',
        (value) => parseQueueEntry(value, 'queueEntry'),
        requestOptions,
        data === undefined ? undefined : projectRequestBody(data, [
          'internationalPassAuthorized', 'useInternationalPassCredit',
        ]),
      );
    },
    /** Closed/departed queue entries are not removable; the winner declines instead. */
    leaveEmptyLegQueue: (emptyLegId: number, requestOptions?: ProductionRequestOptions) =>
      request(`${emptyLegPath(emptyLegId)}/queue`, 'DELETE', parseQueueStatus, requestOptions),
    /**
     * Applies an available skip-line action to an eligible member's queued
     * leg. useCredit spends an existing credit; this method never checks out
     * or sends a payment request. Eligibility is rechecked by the server.
     */
    skipLine: (
      emptyLegId: number,
      data?: PurchaseProductionLineSkipRequest,
      requestOptions?: ProductionRequestOptions,
    ) => {
      if (data !== undefined) validateSkipLine(data);
      return request(
        `${emptyLegPath(emptyLegId)}/skip-line`,
        'POST',
        parseEmptyLeg,
        requestOptions,
        data === undefined ? undefined : projectRequestBody(data, ['useCredit']),
      );
    },
    // This GET inserts the account-holder passenger when missing. Call only
    // from an explicit user-driven action after production auth is enabled.
    getEmptyLegPassengers: (emptyLegId: number, requestOptions?: ProductionRequestOptions) =>
      request(passengersPath(emptyLegId), 'GET', parseEmptyLegPassengerList, requestOptions),
    addEmptyLegPassenger: (
      emptyLegId: number,
      data: ProductionPassengerInput,
      requestOptions?: ProductionRequestOptions,
    ) => {
      validatePassengerInput(data, 'addPassenger');
      return request(passengersPath(emptyLegId), 'POST', parseEmptyLegPassengerList, requestOptions, projectRequestBody(data, [
        'firstName', 'middleName', 'lastName', 'weight', 'gender', 'dob', 'notes',
      ]));
    },
    updateEmptyLegPassenger: (
      emptyLegId: number,
      passengerId: number,
      data: ProductionPassengerInput,
      requestOptions?: ProductionRequestOptions,
    ) => {
      validateNestedId(passengerId, 'passengerId');
      validatePassengerInput(data, 'updatePassenger');
      return request(`${passengersPath(emptyLegId)}/${passengerId}`, 'PATCH', parseEmptyLegPassengerList, requestOptions, projectRequestBody(data, [
        'firstName', 'middleName', 'lastName', 'weight', 'gender', 'dob', 'notes',
      ]));
    },
    removeEmptyLegPassenger: (emptyLegId: number, passengerId: number, requestOptions?: ProductionRequestOptions) => {
      validateNestedId(passengerId, 'passengerId');
      return request(`${passengersPath(emptyLegId)}/${passengerId}`, 'DELETE', parseEmptyLegPassengerList, requestOptions);
    },
    addEmptyLegPet: (
      emptyLegId: number,
      data: ProductionPetInput,
      requestOptions?: ProductionRequestOptions,
    ) => {
      validatePetInput(data, 'addPet');
      return request(`${emptyLegPath(emptyLegId)}/pets`, 'POST', parseEmptyLegPassengerList, requestOptions, projectRequestBody(data, ['breed', 'weight']));
    },
    updateEmptyLegPet: (
      emptyLegId: number,
      petId: number,
      data: ProductionPetInput,
      requestOptions?: ProductionRequestOptions,
    ) => {
      validateNestedId(petId, 'petId');
      validatePetInput(data, 'updatePet');
      return request(`${emptyLegPath(emptyLegId)}/pets/${petId}`, 'PATCH', parseEmptyLegPassengerList, requestOptions, projectRequestBody(data, ['breed', 'weight']));
    },
    removeEmptyLegPet: (emptyLegId: number, petId: number, requestOptions?: ProductionRequestOptions) => {
      validateNestedId(petId, 'petId');
      return request(`${emptyLegPath(emptyLegId)}/pets/${petId}`, 'DELETE', parseEmptyLegPassengerList, requestOptions);
    },
    updateEmptyLegPassengerWeight: (
      emptyLegId: number,
      passengerId: number,
      data: UpdateProductionPassengerWeightRequest,
      requestOptions?: ProductionRequestOptions,
    ) => {
      validateNestedId(passengerId, 'passengerId');
      if (!Number.isSafeInteger(data?.weight) || data.weight < 1 || data.weight > 1000) schemaFailure('passengerWeight.weight');
      return request(`${passengersPath(emptyLegId)}/${passengerId}/weight`, 'PATCH', parseEmptyLegPassengerList, requestOptions, projectRequestBody(data, ['weight']));
    },
    /**
     * Winner eligibility/ranking is resolved under the server lock. Confirm is
     * idempotent for the already-awarded member; decline may promote the next
     * winner. The response is the neutralized EmptyLeg projection.
     */
    confirmEmptyLegWinner: (emptyLegId: number, requestOptions?: ProductionRequestOptions) =>
      request(`${emptyLegPath(emptyLegId)}/winner/confirm`, 'POST', parseEmptyLeg, requestOptions),
    declineEmptyLegWinner: (emptyLegId: number, requestOptions?: ProductionRequestOptions) =>
      request(`${emptyLegPath(emptyLegId)}/winner/decline`, 'POST', parseEmptyLeg, requestOptions),
    startPhoneVerification: (
      data: { countryIso2: string; phoneE164: string },
      requestOptions?: ProductionRequestOptions,
    ) => {
      if (!data || typeof data.countryIso2 !== 'string' || data.countryIso2.length !== 2) schemaFailure('phoneVerification.countryIso2');
      validatePhoneE164(data.phoneE164, 'phoneVerification.phoneE164');
      return request(PRODUCTION_AUTH_PATHS.phoneVerificationStart, 'POST', parsePhoneVerificationStart, requestOptions, projectRequestBody(data, ['countryIso2', 'phoneE164']));
    },
    checkPhoneVerification: (
      data: { phoneE164: string; code: string },
      requestOptions?: ProductionRequestOptions,
    ) => {
      if (!data || !/^\d{6}$/.test(data.code)) schemaFailure('phoneVerification.code');
      validatePhoneE164(data.phoneE164, 'phoneVerification.phoneE164');
      return request(PRODUCTION_AUTH_PATHS.phoneVerificationCheck, 'POST', parsePhoneVerificationStatus, requestOptions, projectRequestBody(data, ['phoneE164', 'code']));
    },
    // This GET can synchronize verified phone data into the profile, Clerk,
    // and Sendblue. It is explicit and is never used as a probe or auto-query.
    getPhoneVerificationStatus: (phoneE164: string, requestOptions?: ProductionRequestOptions) =>
      request(phoneStatusPath(phoneE164), 'GET', parsePhoneVerificationStatus, requestOptions),
  };
}

function notifyDiagnosticTokenResult(
  diagnostic: ProductionAuthDiagnosticHooks | undefined,
  tokenObtained: boolean,
): void {
  try {
    diagnostic?.onTokenResult(tokenObtained);
  } catch {
    // Diagnostic observers must never change request behavior.
  }
}

/** Member identifiers isolate opt-in caches; tokens never belong in cache keys. */
export function productionAuthenticatedQueryKey(
  memberId: string,
  ...segments: readonly (string | number)[]
): readonly ['production-auth', string, ...(string | number)[]] {
  const subject = memberId.trim();
  if (!subject) throw new TypeError('A member ID is required for authenticated cache isolation.');
  return ['production-auth', subject, ...segments] as const;
}
