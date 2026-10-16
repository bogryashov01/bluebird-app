import type {
  ProductionCurrentUser,
  ProductionUserProfile,
  UpdateProductionUserProfileRequest,
} from './productionAuthApi';
import type { ProductionRequestOptions } from './productionAuthApi';
import type { ClerkBluebirdProfileApi } from './clerkBluebirdProfile';

export interface ClerkPersonalInfoValues {
  firstName: string;
  lastName: string;
  dob: string;
  gender: 'male' | 'female' | null;
  weightLbs: string;
}

export type ClerkPersonalInfoLoadResult =
  | { kind: 'api_not_authenticated'; currentUser: ProductionCurrentUser }
  | {
      kind: 'authenticated';
      currentUser: ProductionCurrentUser;
      profile: ProductionUserProfile;
    };

export function getClerkPersonalInfoValues(profile: ProductionUserProfile): ClerkPersonalInfoValues {
  return {
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    dob: profile.dob ?? '',
    gender: profile.gender,
    weightLbs: profile.weightLbs == null ? '' : String(profile.weightLbs),
  };
}

/** Confirm /api/me before reading profile details; this helper never writes. */
export async function loadClerkPersonalInfo(
  api: Pick<ClerkBluebirdProfileApi, 'getMe' | 'getProfile'>,
  signal?: AbortSignal,
): Promise<ClerkPersonalInfoLoadResult> {
  const options = signal ? { signal } : undefined;
  const currentUser = await api.getMe(options);
  if (currentUser.isAuthenticated !== true) {
    return { kind: 'api_not_authenticated', currentUser };
  }
  const profile = await api.getProfile(options);
  return { kind: 'authenticated', currentUser, profile };
}

export function getChangedClerkPersonalInfoFields(
  values: ClerkPersonalInfoValues,
  baseline: ClerkPersonalInfoValues,
): Array<keyof ClerkPersonalInfoValues> {
  const changed: Array<keyof ClerkPersonalInfoValues> = [];
  if (values.firstName.trim() !== baseline.firstName.trim()) changed.push('firstName');
  if (values.lastName.trim() !== baseline.lastName.trim()) changed.push('lastName');
  if (values.dob.trim() !== baseline.dob.trim()) changed.push('dob');
  if (values.gender !== baseline.gender) changed.push('gender');
  if (normalizedWeight(values.weightLbs) !== normalizedWeight(baseline.weightLbs)) {
    changed.push('weightLbs');
  }
  return changed;
}

/**
 * The PUT requires the profile's existing date, gender, airport, and city
 * selection even when the user changes only a name or weight. Do not compose a
 * write unless those required values are available and valid.
 */
export function buildClerkPersonalInfoUpdateRequest(
  profile: ProductionUserProfile,
  values: ClerkPersonalInfoValues,
  baseline: ClerkPersonalInfoValues,
): UpdateProductionUserProfileRequest {
  const firstName = values.firstName.trim();
  const lastName = values.lastName.trim();
  if (!firstName || firstName.length > 80) {
    throw new TypeError('Enter your first name (up to 80 characters).');
  }
  if (!lastName || lastName.length > 80) {
    throw new TypeError('Enter your last name (up to 80 characters).');
  }
  const dob = values.dob.trim();
  if (!isValidPastDateOnly(dob)) {
    throw new TypeError('Enter your date of birth as a valid past date in YYYY-MM-DD format.');
  }
  if (values.gender !== 'male' && values.gender !== 'female') {
    throw new TypeError('Choose a gender before saving.');
  }
  const homeAirportCode = profile.homeAirportCode?.trim() ?? '';
  if (!/^[A-Za-z0-9]{3,4}$/.test(homeAirportCode)) {
    throw new TypeError('A valid home airport is required before these changes can be saved.');
  }
  const favoriteCityKeys = profile.favoriteCityKeys;
  if (
    !Array.isArray(favoriteCityKeys) ||
    favoriteCityKeys.length < 1 ||
    favoriteCityKeys.some((key) => !key.trim() || key.length > 64)
  ) {
    throw new TypeError('At least one valid favorite city is required before these changes can be saved.');
  }

  const changedFields = getChangedClerkPersonalInfoFields(values, baseline);
  if (changedFields.length === 0) throw new TypeError('There are no changes to save.');

  const request: UpdateProductionUserProfileRequest = {
    firstName,
    lastName,
    dob,
    gender: values.gender,
    homeAirportCode,
    favoriteCityKeys: [...favoriteCityKeys],
  };
  if (changedFields.includes('weightLbs')) {
    const weight = values.weightLbs.trim();
    if (!weight) {
      request.weightLbs = null;
    } else {
      const parsedWeight = Number(weight);
      if (!/^\d{1,4}$/.test(weight) || !Number.isSafeInteger(parsedWeight) ||
          parsedWeight < 1 || parsedWeight > 1500) {
        throw new TypeError('Enter a whole-number weight between 1 and 1,500 lbs.');
      }
      request.weightLbs = parsedWeight;
    }
  }
  return request;
}

/** Perform one explicit write and accept success only from an authenticated 2xx projection. */
export async function updateClerkPersonalInfoExplicitly(
  api: Pick<ClerkBluebirdProfileApi, 'updateProfile'>,
  request: UpdateProductionUserProfileRequest,
  options?: ProductionRequestOptions,
): Promise<ProductionCurrentUser> {
  const currentUser = await api.updateProfile(request, options);
  if (currentUser.isAuthenticated !== true) {
    throw new Error('Bluebird did not confirm the profile update. Please try again.');
  }
  return currentUser;
}

function normalizedWeight(value: string): number | null | 'invalid' {
  const normalized = value.trim();
  if (!normalized) return null;
  const weight = Number(normalized);
  return /^\d{1,4}$/.test(normalized) &&
    Number.isSafeInteger(weight) &&
    weight >= 1 &&
    weight <= 1500
    ? weight
    : 'invalid';
}

function isValidPastDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return parsed <= todayUtc;
}
