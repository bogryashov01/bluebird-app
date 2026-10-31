import type { ProductionPassenger, ProductionPassengerInput, UserGender } from './productionAuthApi';

/** Creating a passenger stays off until explicitly authorized. */
export function canCreateProductionPassenger(): boolean {
  return false;
}

/** Updating a passenger stays off until explicitly authorized. */
export function canUpdateProductionPassenger(): boolean {
  return false;
}

/** Deleting a passenger stays off until explicitly authorized. */
export function canDeleteProductionPassenger(): boolean {
  return false;
}

export const MAX_PARTY_SIZE = 6;
export const MAX_ADDITIONAL_PASSENGERS = 5;

/**
 * Gender is required by the current passenger API. Paul still needs to confirm
 * that male and female are the product values. The app does not invent one.
 */
export const PASSENGER_GENDER_NOTE = 'Gender is required by the current passenger API and still needs product confirmation. Choose Male or Female only when the traveler’s gender is known.';

export const PASSENGER_SAVE_UNAVAILABLE = 'Saving passenger changes is unavailable in this build. No request is sent.';

export const PASSENGER_REMOVE_UNAVAILABLE = 'Removing a passenger is unavailable in this build. No request is sent.';

export interface PassengerFormValues {
  firstName: string;
  middleName: string;
  lastName: string;
  weightLbs: string;
  dob: string;
  gender: UserGender | null;
  notes: string;
}

export interface PassengerFormErrors {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  weightLbs?: string;
  dob?: string;
  gender?: string;
  notes?: string;
}

export function emptyPassengerForm(): PassengerFormValues {
  return {
    firstName: '',
    middleName: '',
    lastName: '',
    weightLbs: '',
    dob: '',
    gender: null,
    notes: '',
  };
}

export function passengerFormFromRecord(passenger: Pick<
  ProductionPassenger,
  'firstName' | 'middleName' | 'lastName' | 'weight' | 'dob' | 'gender' | 'notes'
>): PassengerFormValues {
  return {
    firstName: passenger.firstName,
    middleName: passenger.middleName?.trim() ?? '',
    lastName: passenger.lastName,
    weightLbs: passenger.weight === null ? '' : String(passenger.weight),
    dob: passenger.dob,
    gender: passenger.gender === 'male' || passenger.gender === 'female' ? passenger.gender : null,
    notes: passenger.notes?.trim() ?? '',
  };
}

export function passengerPartyLimit(passengerCap: number): number | null {
  if (!Number.isSafeInteger(passengerCap) || passengerCap < 1) return null;
  return Math.min(MAX_PARTY_SIZE, passengerCap);
}

export function additionalPassengerLimit(passengerCap: number): number | null {
  const total = passengerPartyLimit(passengerCap);
  if (total === null) return null;
  return Math.max(0, Math.min(MAX_ADDITIONAL_PASSENGERS, total - 1));
}

/** Writes stay closed unless the server says the manifest is unlocked. */
export function manifestEditsLocked(manifestLocked: boolean | null | undefined): boolean {
  return manifestLocked !== false;
}

export type ManifestLockPresentation = 'locked' | 'unlocked' | 'unknown';

/** The locked screen requires an explicit server true. A missing field is unknown and stays closed for writes. */
export function presentManifestLock(manifestLocked: unknown): ManifestLockPresentation {
  if (manifestLocked === true) return 'locked';
  if (manifestLocked === false) return 'unlocked';
  return 'unknown';
}

export type PassengerManifestAccess = 'loading' | 'error' | 'locked' | 'unlocked' | 'unknown';

/**
 * Resolves the passenger screen from the signed-in account's trip.
 * An empty cache is loading, not locked. A missing lock field is unknown, not unlocked.
 */
export function resolvePassengerManifestAccess(input: {
  legId: number;
  signedIn: boolean;
  activeUserId: string | null;
  accountUserId: string | null;
  phase: 'pending' | 'error' | 'success';
  trip: { leg: { id: number }; checklist: { emptyLegId: number; manifestLocked?: unknown } } | null;
}): PassengerManifestAccess {
  const account = input.accountUserId?.trim() ?? '';
  const active = input.activeUserId?.trim() ?? '';
  if (input.signedIn !== true || account.length === 0 || active !== account) return 'error';
  if (!Number.isSafeInteger(input.legId) || input.legId < 1) return 'error';
  if (input.phase === 'pending') return 'loading';
  if (input.phase !== 'success' || input.trip === null) return 'error';
  const sameLeg = input.trip.leg.id === input.legId || input.trip.checklist.emptyLegId === input.legId;
  if (!sameLeg) return 'error';
  const lock = presentManifestLock(input.trip.checklist.manifestLocked);
  if (lock === 'locked') return 'locked';
  if (lock === 'unlocked') return 'unlocked';
  return 'unknown';
}

export interface PassengerRoster<T> {
  accountHolder: T | null;
  protectedPassengers: T[];
  guests: T[];
}

export function presentPassengerRoster<T extends { isAccountHolder: boolean }>(
  passengers: readonly T[],
): PassengerRoster<T> {
  let accountHolder: T | null = null;
  const protectedPassengers: T[] = [];
  const guests: T[] = [];
  for (const passenger of passengers) {
    if (passenger.isAccountHolder) {
      if (!accountHolder) accountHolder = passenger;
      else protectedPassengers.push(passenger);
    } else {
      guests.push(passenger);
    }
  }
  return { accountHolder, protectedPassengers, guests };
}

export function additionalPassengerOffer(input: {
  passengerCount: number;
  guestCount: number;
  passengerCap: number;
  manifestLocked: boolean | null | undefined;
}): { allowed: boolean; reason: string } {
  if (manifestEditsLocked(input.manifestLocked)) {
    return { allowed: false, reason: 'Passenger changes are locked.' };
  }
  const totalLimit = passengerPartyLimit(input.passengerCap);
  const guestLimit = additionalPassengerLimit(input.passengerCap);
  if (totalLimit === null || guestLimit === null) {
    return { allowed: false, reason: 'Aircraft capacity is unavailable, so another passenger cannot be added.' };
  }
  if (input.guestCount >= guestLimit || input.passengerCount >= totalLimit) {
    if (guestLimit === 0) {
      return { allowed: false, reason: `This aircraft allows ${totalLimit} passenger${totalLimit === 1 ? '' : 's'} total.` };
    }
    if (totalLimit < MAX_PARTY_SIZE) {
      return {
        allowed: false,
        reason: `This aircraft allows ${totalLimit} passengers total, including you. No more passengers can be added.`,
      };
    }
    return { allowed: false, reason: 'You can add up to five additional passengers.' };
  }
  return {
    allowed: true,
    reason: totalLimit < MAX_PARTY_SIZE
      ? `This aircraft allows ${totalLimit} passengers total, including you.`
      : 'You can add up to five additional passengers.',
  };
}

export function validatePassengerForm(
  values: PassengerFormValues,
  today = utcDateOnly(),
): { ok: true; body: ProductionPassengerInput } | { ok: false; errors: PassengerFormErrors } {
  const errors: PassengerFormErrors = {};
  const firstName = values.firstName.trim();
  const lastName = values.lastName.trim();
  const middleName = values.middleName.trim();
  const notes = values.notes.trim();
  if (firstName.length < 1 || firstName.length > 100) errors.firstName = 'Enter a first name.';
  if (lastName.length < 1 || lastName.length > 100) errors.lastName = 'Enter a last name.';
  if (middleName.length > 100) errors.middleName = 'Middle name must be 100 characters or fewer.';
  if (!/^\d+$/.test(values.weightLbs.trim())) {
    errors.weightLbs = 'Enter a whole number of pounds.';
  } else {
    const weight = Number(values.weightLbs.trim());
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > 1000) {
      errors.weightLbs = 'Enter a weight from 1 to 1,000 lbs.';
    }
  }
  if (!isValidDateOnly(values.dob.trim(), today)) errors.dob = 'Enter a valid date of birth as YYYY-MM-DD.';
  if (values.gender !== 'male' && values.gender !== 'female') errors.gender = 'Select a gender.';
  if (notes.length > 500) errors.notes = 'Notes must be 500 characters or fewer.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const body: ProductionPassengerInput = {
    firstName,
    lastName,
    weight: Number(values.weightLbs.trim()),
    gender: values.gender as UserGender,
    dob: values.dob.trim(),
  };
  if (middleName) body.middleName = middleName;
  if (notes) body.notes = notes;
  return { ok: true, body };
}

export type PassengerMutationReview =
  | { status: 'invalid'; errors: PassengerFormErrors }
  | { status: 'needs-confirmation'; method: 'DELETE'; path: string; body: null }
  | { status: 'disabled'; method: 'POST' | 'PATCH' | 'DELETE'; path: string; body: ProductionPassengerInput | null }
  | { status: 'ready'; method: 'POST' | 'PATCH' | 'DELETE'; path: string; body: ProductionPassengerInput | null };

export function reviewCreateProductionPassenger(
  legId: number,
  values: PassengerFormValues,
  today = utcDateOnly(),
): PassengerMutationReview {
  if (!Number.isSafeInteger(legId) || legId < 1) return { status: 'invalid', errors: {} };
  const validated = validatePassengerForm(values, today);
  if (!validated.ok) return { status: 'invalid', errors: validated.errors };
  const path = `/empty-legs/${legId}/passengers`;
  if (!canCreateProductionPassenger()) return { status: 'disabled', method: 'POST', path, body: validated.body };
  return { status: 'ready', method: 'POST', path, body: validated.body };
}

export function reviewUpdateProductionPassenger(
  legId: number,
  passengerId: number,
  values: PassengerFormValues,
  today = utcDateOnly(),
): PassengerMutationReview {
  if (!Number.isSafeInteger(legId) || legId < 1 || !Number.isSafeInteger(passengerId) || passengerId < 1) {
    return { status: 'invalid', errors: {} };
  }
  const validated = validatePassengerForm(values, today);
  if (!validated.ok) return { status: 'invalid', errors: validated.errors };
  const path = `/empty-legs/${legId}/passengers/${passengerId}`;
  if (!canUpdateProductionPassenger()) return { status: 'disabled', method: 'PATCH', path, body: validated.body };
  return { status: 'ready', method: 'PATCH', path, body: validated.body };
}

export function reviewDeleteProductionPassenger(
  legId: number,
  passengerId: number,
  isAccountHolder: boolean,
  explicitConfirm: boolean,
): PassengerMutationReview {
  if (!Number.isSafeInteger(legId) || legId < 1 || !Number.isSafeInteger(passengerId) || passengerId < 1 || isAccountHolder) {
    return { status: 'invalid', errors: {} };
  }
  const path = `/empty-legs/${legId}/passengers/${passengerId}`;
  if (explicitConfirm !== true) return { status: 'needs-confirmation', method: 'DELETE', path, body: null };
  if (!canDeleteProductionPassenger()) return { status: 'disabled', method: 'DELETE', path, body: null };
  return { status: 'ready', method: 'DELETE', path, body: null };
}

export function presentPassengerFailure(status: number | null): { title: string; body: string } {
  if (status === 400) {
    return { title: 'Check passenger details', body: 'Bluebird did not accept these passenger details. Nothing was changed.' };
  }
  if (status === 401) {
    return { title: 'Sign in required', body: 'Sign in again before viewing passenger information.' };
  }
  if (status === 403) {
    return { title: 'Not available', body: 'Passenger information is not available for this account. The manifest may be locked.' };
  }
  if (status === 404) {
    return { title: 'Unavailable', body: 'This flight or passenger is no longer available.' };
  }
  if (status === 409) {
    return { title: 'No remaining seats', body: 'This aircraft has no remaining passenger seats. Nothing was changed.' };
  }
  return { title: 'Connection problem', body: 'Passenger information could not be loaded. Nothing was changed.' };
}

export function shouldApplyPassengerManifest(input: {
  requestedUserId: string;
  activeUserId: string | null;
  signedIn: boolean;
}): boolean {
  const requested = input.requestedUserId.trim();
  return input.signedIn === true && requested.length > 0 && input.activeUserId === requested;
}

export function manifestMatchesFlight(
  records: readonly { emptyLegId: number }[],
  flightId: number,
): boolean {
  return records.every((record) => record.emptyLegId === flightId);
}

export const PASSENGER_RECORDED = 'Bluebird recorded this passenger.';
export const PASSENGER_UPDATED = 'Bluebird recorded the passenger changes.';
export const PASSENGER_REMOVED = 'Bluebird recorded the removal.';
export const PASSENGER_UNCONFIRMED = 'Bluebird did not confirm this passenger change. Nothing was saved on this device.';
export const PASSENGER_DUPLICATE = 'A passenger request is already in progress. No second request was sent.';
export const PASSENGER_LOCKED = 'Passenger changes are locked. No request was sent.';
export const PASSENGER_CAPACITY = 'This flight has no room for another passenger. No request was sent.';
export const PASSENGER_PROTECTED = 'The account holder’s passenger record cannot be removed. No request was sent.';

export function passengerMatchesInput(
  passenger: Pick<ProductionPassenger, 'firstName' | 'lastName' | 'middleName' | 'weight' | 'gender' | 'dob' | 'notes'>,
  body: ProductionPassengerInput,
): boolean {
  if (passenger.firstName !== body.firstName || passenger.lastName !== body.lastName) return false;
  if (passenger.weight !== body.weight || passenger.gender !== body.gender || passenger.dob !== body.dob) return false;
  if (body.middleName && passenger.middleName !== body.middleName) return false;
  if (body.notes && passenger.notes !== body.notes) return false;
  return true;
}

/** A write counts only when every returned record belongs to this flight. */
export function acceptedPassengerList(
  flightId: number,
  list: { passengers: readonly { emptyLegId: number }[]; pets: readonly { emptyLegId: number }[] },
): typeof list | null {
  if (!Number.isSafeInteger(flightId) || flightId < 1) return null;
  if (!manifestMatchesFlight([...list.passengers, ...list.pets], flightId)) return null;
  return list;
}

export function createdPassengerConfirmed(
  flightId: number,
  list: { passengers: readonly ProductionPassenger[]; pets: readonly { emptyLegId: number }[] },
  body: ProductionPassengerInput,
): boolean {
  const accepted = acceptedPassengerList(flightId, list);
  if (!accepted) return false;
  return list.passengers.some((passenger) =>
    passenger.emptyLegId === flightId && passengerMatchesInput(passenger, body));
}

export function updatedPassengerConfirmed(
  flightId: number,
  passengerId: number,
  list: { passengers: readonly ProductionPassenger[]; pets: readonly { emptyLegId: number }[] },
  body: ProductionPassengerInput,
): ProductionPassenger | null {
  const accepted = acceptedPassengerList(flightId, list);
  if (!accepted || !Number.isSafeInteger(passengerId) || passengerId < 1) return null;
  const passenger = list.passengers.find((row) => row.id === passengerId && row.emptyLegId === flightId);
  if (!passenger || !passengerMatchesInput(passenger, body)) return null;
  return passenger;
}

export function deletedPassengerConfirmed(
  flightId: number,
  passengerId: number,
  list: { passengers: readonly { id: number; emptyLegId: number }[]; pets: readonly { emptyLegId: number }[] },
): boolean {
  const accepted = acceptedPassengerList(flightId, list);
  if (!accepted || !Number.isSafeInteger(passengerId) || passengerId < 1) return false;
  return !list.passengers.some((passenger) => passenger.id === passengerId);
}

export function presentPetSummary(petCount: number): string | null {
  if (!Number.isSafeInteger(petCount) || petCount < 1) return null;
  return petCount === 1
    ? 'This flight includes 1 pet record. Pet changes are not available here.'
    : `This flight includes ${petCount} pet records. Pet changes are not available here.`;
}

export function displayPassengerName(passenger: Pick<ProductionPassenger, 'firstName' | 'middleName' | 'lastName'>): string {
  return [passenger.firstName, passenger.middleName, passenger.lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ');
}

function isValidDateOnly(value: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return value <= today;
}

function utcDateOnly(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
