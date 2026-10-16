import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditClerkBluebirdProfile,
  getClerkOnboardingStep,
  getClerkBluebirdProfileEffectDependencies,
  isClerkBluebirdProfileResultCurrent,
  loadClerkBluebirdMembership,
  loadClerkBluebirdProfile,
  saveClerkBluebirdRegistration,
  ClerkRegistrationCompletionError,
  checkClerkBluebirdRegistrationStatus,
  diagnoseClerkBluebirdRegistrationProfile,
  getClerkRegistrationCompletionCheck,
  getClerkRegistrationWriteOutcome,
  updateClerkBluebirdProfileExplicitly,
} from "../scripts/.clerk-bluebird-profile.test.mjs";
import {
  buildClerkPersonalInfoUpdateRequest,
  getChangedClerkPersonalInfoFields,
  getClerkPersonalInfoValues,
  loadClerkPersonalInfo,
  updateClerkPersonalInfoExplicitly,
} from "../scripts/.clerk-personal-info.test.mjs";
import {
  CLERK_PROFILE_SAVE_LIMITATION,
  buildClerkProfileUpdateRequest,
  canAccessClerkProfileOnboardingRoute,
  getClerkProfileRegistrationDraft,
  getVerifiedClerkPhoneNumber,
  getClerkAirportSelectionDraft,
  getClerkOnboardingAfterTourDestination,
  prefillClerkProfileForm,
  canEditClerkRegistrationEmail,
  getClerkRegistrationEmailValue,
  isValidClerkRegistrationEmail,
  consumeClerkVerifiedRegistrationCompletion,
  setClerkHomeAirportDraft,
  setClerkProfileFormDraft,
  setClerkProfileRegistrationDraft,
  setClerkRegistrationProfileResult,
  setClerkVerifiedRegistrationCompletion,
  filterClerkRegistrationAirports,
  filterClerkRegistrationCities,
  toggleClerkAdditionalAirportDraft,
  toggleClerkFavoriteCityDraft,
  validateClerkAirportCitySelection,
  setClerkAirportSelectionDraft,
  validateClerkProfileForm,
} from "../scripts/.clerk-profile-onboarding.test.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const profile = {
  firstName: null,
  lastName: null,
  dob: null,
  gender: null,
  homeAirportCode: null,
  homeAirportLabel: null,
  favoriteAirportCodes: [],
  favoriteAirportLabels: [],
  favoriteCityKeys: [],
  favoriteCityLabels: [],
  phoneE164: null,
  phoneCountry: null,
  phoneVerifiedAt: null,
  phoneVerificationRequired: true,
  notificationPrefs: {
    mode: "off",
    allChannels: null,
    emptyLegHomeAirport: null,
    departingFavorite: null,
    arrivingFavorite: null,
    queueUpdates: "email",
    winningNotifications: "email",
  },
  smsConsent: false,
  smsConsentAt: null,
  smsConsentRevokedAt: null,
  email: null,
  emailLocked: false,
  signupChannel: "phone",
  isComplete: false,
  upgradeCreditBalances: { skipTheLine: 0, internationalPass: 0 },
  weightLbs: null,
};

const nonmemberMembership = {
  isMember: false,
  tier: null,
  cancelAtPeriodEnd: false,
  recentEvents: [],
};

function currentUser(overrides = {}) {
  return {
    isAuthenticated: true,
    isAdmin: false,
    isConcierge: false,
    isMember: false,
    memberTier: null,
    email: null,
    firstName: null,
    lastName: null,
    isProfileComplete: false,
    needsPlanDecision: false,
    needsSignupPhone: true,
    impersonation: null,
    ...overrides,
  };
}

function fakeApi({
  me = currentUser(),
  loadedProfile = profile,
  loadedMembership = nonmemberMembership,
  membershipError = null,
  updateResult = currentUser(),
} = {}) {
  const calls = [];
  return {
    calls,
    getMe: async (options) => {
      calls.push({ method: "GET", path: "/me", options });
      options?.onResponseStatus?.(200);
      return me;
    },
    getProfile: async (options) => {
      calls.push({ method: "GET", path: "/me/profile", options });
      return loadedProfile;
    },
    getMembership: async (options) => {
      calls.push({ method: "GET", path: "/membership", options });
      if (membershipError) throw membershipError;
      return loadedMembership;
    },
    updateProfile: async (data, options) => {
      calls.push({ method: "PUT", path: "/me/profile", data, options });
      options?.onResponseStatus?.(200);
      return updateResult;
    },
  };
}

const completePersonalInfoProfile = {
  ...profile,
  firstName: "Avery",
  lastName: "Passenger",
  dob: "1985-04-03",
  gender: "female",
  homeAirportCode: "SFO",
  homeAirportLabel: "San Francisco International",
  favoriteCityKeys: ["san-francisco"],
  favoriteCityLabels: ["San Francisco"],
};

test("Personal Information confirms /me before profile GET and performs no write while loading", async () => {
  const calls = [];
  const api = {
    getMe: async () => {
      calls.push("GET /me");
      return currentUser({ isAuthenticated: true });
    },
    getProfile: async () => {
      calls.push("GET /me/profile");
      return completePersonalInfoProfile;
    },
    updateProfile: async () => {
      calls.push("PUT /me/profile");
      throw new Error("A profile write must require an explicit action.");
    },
  };

  const loaded = await loadClerkPersonalInfo(api);
  assert.equal(loaded.kind, "authenticated");
  assert.deepEqual(calls, ["GET /me", "GET /me/profile"]);

  const anonymousCalls = [];
  const anonymous = await loadClerkPersonalInfo({
    getMe: async () => {
      anonymousCalls.push("GET /me");
      return currentUser({ isAuthenticated: false });
    },
    getProfile: async () => {
      anonymousCalls.push("GET /me/profile");
      return completePersonalInfoProfile;
    },
  });
  assert.equal(anonymous.kind, "api_not_authenticated");
  assert.deepEqual(anonymousCalls, ["GET /me"]);
});

test("profile GET errors remain unavailable after authenticated /me and never write", async () => {
  const calls = [];
  await assert.rejects(
    () => loadClerkPersonalInfo({
      getMe: async () => {
        calls.push("GET /me");
        return currentUser({ isAuthenticated: true });
      },
      getProfile: async () => {
        calls.push("GET /me/profile");
        throw new Error("profile endpoint unavailable");
      },
      updateProfile: async () => {
        calls.push("PUT /me/profile");
        throw new Error("Profile reads must not trigger writes.");
      },
    }),
    /profile endpoint unavailable/,
  );
  assert.deepEqual(calls, ["GET /me", "GET /me/profile"]);
});

test("Personal Information represents absent optional values as empty and requires safe PUT fields", () => {
  const optionalProfile = {
    ...completePersonalInfoProfile,
    email: null,
    phoneE164: null,
    phoneVerifiedAt: null,
    weightLbs: null,
    homeAirportCode: null,
    favoriteCityKeys: [],
  };
  const values = getClerkPersonalInfoValues(optionalProfile);
  assert.deepEqual(values, {
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    weightLbs: "",
  });
  assert.throws(
    () => buildClerkPersonalInfoUpdateRequest(
      optionalProfile,
      { ...values, firstName: "Avery Updated" },
      values,
    ),
    /valid home airport/i,
  );
  assert.deepEqual(
    getChangedClerkPersonalInfoFields(values, values),
    [],
    "the initial read creates no dirty fields and cannot show Save",
  );
});

test("Personal Information PUT contains only required profile fields and a changed optional weight", () => {
  const baseline = getClerkPersonalInfoValues(completePersonalInfoProfile);
  const values = { ...baseline, firstName: " Avery Updated ", weightLbs: "142" };
  const request = buildClerkPersonalInfoUpdateRequest(completePersonalInfoProfile, values, baseline);

  assert.deepEqual(request, {
    firstName: "Avery Updated",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    weightLbs: 142,
  });
  for (const excluded of [
    "email", "phoneE164", "phoneCountry", "notificationPrefs", "smsConsent",
    "favoriteAirportCodes", "favoriteCityLabels", "homeAirportLabel",
  ]) {
    assert.equal(excluded in request, false, `${excluded} must not be included`);
  }

  const clearWeight = buildClerkPersonalInfoUpdateRequest(
    { ...completePersonalInfoProfile, weightLbs: 142 },
    { ...baseline, weightLbs: "" },
    { ...baseline, weightLbs: "142" },
  );
  assert.equal(clearWeight.weightLbs, null);
});

test("Personal Information rejects invalid edits and only accepts an authenticated save response", async () => {
  const baseline = getClerkPersonalInfoValues(completePersonalInfoProfile);
  assert.throws(
    () => buildClerkPersonalInfoUpdateRequest(
      completePersonalInfoProfile,
      { ...baseline, weightLbs: "142.5" },
      baseline,
    ),
    /whole-number weight/i,
  );
  assert.throws(
    () => buildClerkPersonalInfoUpdateRequest(
      completePersonalInfoProfile,
      { ...baseline, dob: "1985-02-30" },
      baseline,
    ),
    /valid past date/i,
  );

  let writes = 0;
  const request = buildClerkPersonalInfoUpdateRequest(
    completePersonalInfoProfile,
    { ...baseline, firstName: "Avery Updated" },
    baseline,
  );
  await assert.rejects(
    () => updateClerkPersonalInfoExplicitly({
      updateProfile: async () => {
        writes += 1;
        throw new Error("request rejected");
      },
    }, request),
    /request rejected/,
  );
  assert.equal(writes, 1, "a failed explicit save is not retried");
  await assert.rejects(
    () => updateClerkPersonalInfoExplicitly({
      updateProfile: async () => currentUser({ isAuthenticated: false }),
    }, request),
    /did not confirm/i,
  );
  const accepted = await updateClerkPersonalInfoExplicitly({
    updateProfile: async () => currentUser({ isAuthenticated: true }),
  }, request);
  assert.equal(accepted.isAuthenticated, true);
});

test("an API-authenticated nonmember can load their incomplete profile without member or write calls", async () => {
  const api = fakeApi();
  const result = await loadClerkBluebirdProfile(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.currentUser.isAuthenticated, true);
  assert.equal(result.currentUser.isMember, false);
  assert.equal(result.currentUser.needsSignupPhone, true);
  assert.equal(result.completion, "completion_required");
  assert.equal(result.membershipState, "available");
  assert.equal(getClerkOnboardingStep(result), "profile");
  assert.equal(canEditClerkBluebirdProfile(result), true);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /me/profile",
    "GET /membership",
  ]);
});

test("profile screen reuses the already-verified post-login /me response", async () => {
  const api = fakeApi();
  const verifiedMe = currentUser({
    isProfileComplete: false,
    firstName: "Saved",
    lastName: "Member",
  });
  const result = await loadClerkBluebirdProfile(api, undefined, verifiedMe);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.currentUser, verifiedMe);
  assert.equal(result.currentUser.firstName, "Saved");
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me/profile",
    "GET /membership",
  ]);
});

test("membership read confirms /me first and shows only a matching member projection", async () => {
  const member = currentUser({ isMember: true, memberTier: "base" });
  const membership = {
    isMember: true,
    tier: "base",
    status: "active",
    cancelAtPeriodEnd: false,
    startedAt: "2024-02-12T00:00:00.000Z",
    currentPeriodEnd: null,
    paymentStatus: null,
    recentEvents: [],
  };
  const api = fakeApi({ me: member, loadedMembership: membership });

  const result = await loadClerkBluebirdMembership(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.membershipState, "available");
  assert.equal(result.currentUser, member);
  assert.equal(result.membership, membership);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /membership",
  ]);
  assert.equal(api.calls.some(({ method }) => method === "PUT"), false);
});

test("membership read confirms non-members and does not infer missing optional details", async () => {
  const api = fakeApi({
    me: currentUser({ isMember: false, memberTier: null }),
    loadedMembership: {
      isMember: false,
      tier: null,
      cancelAtPeriodEnd: false,
      recentEvents: [],
    },
  });
  const result = await loadClerkBluebirdMembership(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.membershipState, "available");
  assert.equal(result.membership?.isMember, false);
  assert.equal(result.membership?.tier, null);
  assert.equal("startedAt" in result.membership, false);
  assert.equal(api.calls.some(({ method, path }) => path === "/me/profile"), false);
});

test("membership endpoint errors preserve only the /me projection and mark details unavailable", async () => {
  const member = currentUser({ isMember: true, memberTier: "plus" });
  const api = fakeApi({
    me: member,
    membershipError: new Error("membership endpoint unavailable"),
  });
  const result = await loadClerkBluebirdMembership(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.currentUser, member);
  assert.equal(result.membership, null);
  assert.equal(result.membershipState, "unavailable");
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /membership",
  ]);
});

test("membership is not requested when /me does not authenticate the Clerk session", async () => {
  const api = fakeApi({ me: currentUser({ isAuthenticated: false }) });
  const result = await loadClerkBluebirdMembership(api);

  assert.equal(result.kind, "api_not_authenticated");
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), ["GET /me"]);
});

test("membership projection conflicts stay unavailable instead of mixing account values", async () => {
  const api = fakeApi({
    me: currentUser({ isMember: true, memberTier: "plus" }),
    loadedMembership: {
      isMember: true,
      tier: "base",
      cancelAtPeriodEnd: false,
      recentEvents: [],
    },
  });
  const result = await loadClerkBluebirdMembership(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.membershipState, "conflict");
});

test("profile form prefills only the requested fields and uses Clerk's verified phone", () => {
  const saved = {
    ...profile,
    firstName: "Avery",
    lastName: "Passenger",
    email: "avery@example.test",
    dob: "1985-04-03",
    gender: "female",
    phoneE164: "+15555550111",
    weightLbs: 142,
  };
  assert.deepEqual(prefillClerkProfileForm(saved, "+15555550123"), {
    firstName: "Avery",
    lastName: "Passenger",
    email: "avery@example.test",
    phoneE164: "+15555550123",
    dob: "1985-04-03",
    gender: "female",
    weightLbs: "142",
  });
  assert.deepEqual(prefillClerkProfileForm(profile, null), {
    firstName: "",
    lastName: "",
    email: "",
    phoneE164: "",
    dob: "",
    gender: null,
    weightLbs: "",
  });
});

test("email validation accepts a valid address and rejects missing or malformed values", () => {
  assert.equal(isValidClerkRegistrationEmail("member@example.test"), true);
  assert.equal(isValidClerkRegistrationEmail("  member@example.test  "), true);
  assert.equal(isValidClerkRegistrationEmail(""), false);
  assert.equal(isValidClerkRegistrationEmail("not-an-email"), false);
  assert.equal(isValidClerkRegistrationEmail("member@localhost"), false);

  const values = {
    firstName: "Avery",
    lastName: "Passenger",
    email: "member@example.test",
    phoneE164: "+15555550123",
    dob: "1985-04-03",
    gender: "female",
    weightLbs: "",
  };
  assert.equal(validateClerkProfileForm(values), null);
  assert.match(validateClerkProfileForm({ ...values, email: "" }), /valid email/i);
  assert.match(validateClerkProfileForm({ ...values, email: "bad-email" }), /valid email/i);
});

test("locked provider email is displayed from the profile, read-only, and excluded from writes", () => {
  const lockedProfile = {
    ...profile,
    email: "provider@example.test",
    emailLocked: true,
  };
  assert.equal(canEditClerkRegistrationEmail(lockedProfile), false);
  assert.equal(canEditClerkRegistrationEmail(profile), true);
  assert.equal(
    getClerkRegistrationEmailValue(lockedProfile, "stale-draft@example.test"),
    "provider@example.test",
  );
  assert.equal(getClerkRegistrationEmailValue(profile, "draft@example.test"), "draft@example.test");

  const request = buildClerkProfileUpdateRequest({
    values: {
      firstName: "Avery",
      lastName: "Passenger",
      email: "stale-draft@example.test",
      phoneE164: "+15555550123",
      dob: "1985-04-03",
      gender: "female",
      weightLbs: "",
    },
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    catalogKeys: ["san-francisco"],
    profile: lockedProfile,
  });
  assert.equal("email" in request, false);

  const source = readFileSync(resolve(projectRoot, "app/account/bluebird-profile.tsx"), "utf8");
  assert.ok(source.includes('editable={canEditClerkRegistrationEmail(profile)}'));
  assert.ok(source.includes('value={getClerkRegistrationEmailValue(profile, values.email)}'));
});

test("phone prefill requires a verified phone on the same active Clerk identity", () => {
  const sameIdentity = {
    sessionUserId: "member-a",
    clerkUserId: "member-a",
    phoneNumber: "+15555550123",
    verificationStatus: "verified",
  };
  assert.equal(getVerifiedClerkPhoneNumber(sameIdentity), "+15555550123");
  assert.equal(getVerifiedClerkPhoneNumber({ ...sameIdentity, verificationStatus: "unverified" }), null);
  assert.equal(getVerifiedClerkPhoneNumber({ ...sameIdentity, clerkUserId: "member-b" }), null);
  assert.equal(getVerifiedClerkPhoneNumber({ ...sameIdentity, sessionUserId: null }), null);
});

test("profile form validates names, verified phone, date-only DOB, gender and optional whole-number pounds", () => {
  const values = {
    firstName: " Avery ",
    lastName: " Passenger ",
    email: "  member@example.test ",
    phoneE164: "+15555550123",
    dob: "1985-04-03",
    gender: "female",
    weightLbs: "142",
  };
  assert.equal(validateClerkProfileForm(values), null);
  assert.match(validateClerkProfileForm({ ...values, phoneE164: "" }), /verified phone/i);
  assert.match(validateClerkProfileForm({ ...values, gender: null }), /gender/i);
  assert.match(validateClerkProfileForm({ ...values, dob: "1985-02-30" }), /YYYY-MM-DD/i);
  assert.match(validateClerkProfileForm({ ...values, dob: "2999-01-01" }), /YYYY-MM-DD/i);
  assert.match(validateClerkProfileForm({ ...values, weightLbs: "142.5" }), /whole-number weight/i);
  assert.match(validateClerkProfileForm({ ...values, weightLbs: "0" }), /1 and 1,500/i);
  assert.equal(validateClerkProfileForm({ ...values, weightLbs: "" }), null);
});

test("registration has three explicit steps and keeps personal information draft-only", () => {
  assert.match(CLERK_PROFILE_SAVE_LIMITATION, /date of birth/i);
  assert.match(CLERK_PROFILE_SAVE_LIMITATION, /home airport/i);
  assert.match(CLERK_PROFILE_SAVE_LIMITATION, /at least one city/i);
  assert.equal(CLERK_PROFILE_SAVE_LIMITATION.includes("Preferred City"), false);
  assert.match(CLERK_PROFILE_SAVE_LIMITATION, /weight is optional/i);
  const source = readFileSync(resolve(projectRoot, "app/account/bluebird-profile.tsx"), "utf8");
  for (const label of ["First Name", "Last Name", "Email", "Phone", "Date of Birth", "Gender", "Weight (lbs)"]) {
    assert.ok(source.includes(label), `profile is missing ${label}`);
  }
  assert.ok(source.includes("Step 1 of 3 · Personal Information"));
  assert.ok(source.includes("Continue to Select Airports"));
  assert.ok(source.includes('keyboardType="number-pad"'), "weight should use the numeric keyboard");
  assert.ok(source.includes("accessibilityState={{ selected: values.gender === gender }}"));
  assert.ok(source.includes("validateClerkProfileForm({ ...values, email })"));
  for (const diagnostic of [
    "profile-api-auth-state",
    "profile-membership-state",
    "profile-completion-state",
    "Not provided",
  ]) {
    assert.equal(source.includes(diagnostic), false, `diagnostic UI remains: ${diagnostic}`);
  }
  assert.equal(source.includes("updateProfile("), false);
  assert.equal(source.includes("startPhoneVerification("), false);
  const airportSource = readFileSync(resolve(projectRoot, "app/airport-picker.tsx"), "utf8");
  assert.ok(airportSource.includes("STEP 2 OF 3"));
  assert.ok(airportSource.includes("registration-${tab}-tab"));
  assert.ok(airportSource.includes("registration-airport-search"));
  assert.ok(airportSource.includes("registration-city-search"));
  assert.ok(airportSource.includes("fetchProductionAirportSearch(debouncedAirportSearch"));
  assert.ok(airportSource.includes("enabled: !!configuration && !!debouncedAirportSearch"));
  assert.ok(airportSource.includes("registration-airport-search-prompt"));
  assert.ok(airportSource.includes("registration-airport-no-match"));
  assert.ok(airportSource.includes("airportSearchState.failure.retryable"));
  assert.equal(airportSource.includes("fetchProductionAirports([]"), false);
  assert.ok(airportSource.includes("fetchProductionAirportCities"));
  assert.ok(airportSource.includes("registration-home-airport-${airport.code}"));
  assert.ok(airportSource.includes("fetchProductionAirports([draft.homeAirportCode]"));
  assert.ok(airportSource.includes("enabled: !!configuration && !!draft.homeAirportCode"));
  assert.ok(airportSource.includes("registration-home-airport-details-error"));
  assert.ok(airportSource.includes("airport={resolvedHomeAirport}"));
  assert.ok(airportSource.includes("testID={`registration-home-airport-${draft.homeAirportCode}`}"));
  assert.match(airportSource, /\{\s*draft\.homeAirportCode\s*\}\s*<\/Text>/);
  assert.ok(airportSource.includes("The full airport list isn’t available to browse."));
  assert.equal(airportSource.includes("registration-additional-airport-"), false);
  assert.equal(airportSource.includes("toggleClerkAdditionalAirportDraft"), false);
  assert.ok(airportSource.includes("registration-city-${city.key}"));
  assert.ok(airportSource.includes("enabled: !!configuration"));
  assert.ok(airportSource.includes("draft.favoriteCityKeys"));
  assert.ok(airportSource.includes("KeyboardAwareScrollViewCompat"));
  assert.ok(airportSource.includes("continue-to-registration-review"));
  assert.ok(airportSource.includes("toggleClerkFavoriteCityDraft"));
  assert.ok(airportSource.includes("favoriteCityKeys"));
  const reviewSource = readFileSync(resolve(projectRoot, "app/registration-review.tsx"), "utf8");
  assert.ok(reviewSource.includes("STEP 3 OF 3"));
  assert.ok(reviewSource.includes("Review &amp; Save"));
  assert.ok(reviewSource.includes("saveClerkBluebirdRegistration"));
  assert.ok(reviewSource.includes("checkClerkBluebirdRegistrationStatus"));
  assert.ok(reviewSource.includes('testID="check-registration-status"'));
  assert.ok(reviewSource.includes('testID="continue-after-registration-confirmed"'));
  assert.ok(reviewSource.includes("describeRegistrationWriteOutcome"));
  assert.ok(reviewSource.includes("describeRegistrationCompletionCheck"));
  assert.ok(reviewSource.includes("savingRef.current"));
  assert.ok(reviewSource.includes("back-from-registration-review"));
  assert.ok(reviewSource.includes("Confirm & Save"));
  assert.ok(reviewSource.includes("Weight is optional and will only be marked saved if Bluebird confirms it."));
  assert.ok(reviewSource.includes("fetchProductionAirports(selectedAirportCodes"));
  assert.ok(reviewSource.includes("selectedAirportCodes.length > 0"));
  assert.ok(reviewSource.includes("registration-airport-details-error"));
  assert.ok(reviewSource.includes("setClerkVerifiedRegistrationCompletion"));
  assert.ok(reviewSource.includes("check.emailMissing"));
  assert.ok(reviewSource.includes("still reports that your email is missing"));
  assert.ok(reviewSource.includes("__DEV__"));
  assert.ok(reviewSource.includes("configuration?.environment === 'development'"));
  assert.ok(reviewSource.includes('testID="diagnose-saved-profile"'));
  assert.ok(reviewSource.includes("may synchronize verified Clerk phone information"));
  assert.ok(reviewSource.includes("diagnoseClerkBluebirdRegistrationProfile"));
  assert.equal(reviewSource.includes("draft.additionalAirportCodes"), false);
  assert.equal(reviewSource.includes("additionalAirportCodes: data"), false);
});

test("registration draft keeps selections by Clerk identity and supports only one home airport", () => {
  const saved = { ...profile, firstName: "Avery", email: "saved@example.test", dob: "1985-04-03" };
  const initial = getClerkProfileRegistrationDraft("registration-user-a", saved, "+15555550123");
  assert.equal(initial.values.firstName, "Avery");
  assert.equal(initial.values.email, "saved@example.test");
  assert.equal(initial.values.dob, "1985-04-03");
  assert.deepEqual(initial.favoriteCityKeys, []);
  setClerkProfileFormDraft("registration-user-a", {
    ...initial.values,
    firstName: "Draft name",
    email: "draft@example.test",
    dob: "1986-02-01",
  });
  setClerkHomeAirportDraft("registration-user-a", "SFO");
  assert.deepEqual(toggleClerkAdditionalAirportDraft("registration-user-a", "JFK"), ["JFK"]);
  assert.deepEqual(toggleClerkAdditionalAirportDraft("registration-user-a", "LAX"), ["JFK", "LAX"]);
  setClerkHomeAirportDraft("registration-user-a", "JFK");
  assert.equal(getClerkProfileRegistrationDraft("registration-user-a").values.firstName, "Draft name");
  assert.equal(getClerkProfileRegistrationDraft("registration-user-a").values.email, "draft@example.test");
  assert.deepEqual(getClerkAirportSelectionDraft("registration-user-a"), ["JFK"]);
  assert.deepEqual(getClerkProfileRegistrationDraft("registration-user-a").additionalAirportCodes, ["LAX"]);
  assert.equal(getClerkProfileRegistrationDraft("registration-user-b").values.firstName, "");
  assert.deepEqual(getClerkProfileRegistrationDraft("registration-user-b").favoriteCityKeys, []);
  assert.deepEqual(getClerkProfileRegistrationDraft("registration-user-b").additionalAirportCodes, []);
});

test("canonical city selection supports multiple catalog keys and requires at least one", () => {
  const canonicalKeys = ["new-york-city", "san-francisco"];
  assert.deepEqual(toggleClerkFavoriteCityDraft("registration-city-user", "new-york-city", canonicalKeys), ["new-york-city"]);
  assert.deepEqual(toggleClerkFavoriteCityDraft("registration-city-user", "san-francisco", canonicalKeys), ["new-york-city", "san-francisco"]);
  assert.deepEqual(toggleClerkFavoriteCityDraft("registration-city-user", "new-york-city", canonicalKeys), ["san-francisco"]);
  assert.deepEqual(toggleClerkFavoriteCityDraft("registration-city-user", "not-canonical", canonicalKeys), ["san-francisco"]);
  assert.match(validateClerkAirportCitySelection({
    homeAirportCode: "SFO",
    favoriteCityKeys: ["SFO"],
    catalogKeys: canonicalKeys,
  }), /no longer available/i);
  assert.match(validateClerkAirportCitySelection({
    homeAirportCode: "SFO",
    favoriteCityKeys: [],
    catalogKeys: canonicalKeys,
  }), /at least one city/i);
  assert.equal(validateClerkAirportCitySelection({
    homeAirportCode: "sfo",
    favoriteCityKeys: ["san-francisco", "new-york-city"],
    catalogKeys: canonicalKeys,
  }), null);
  const retained = getClerkProfileRegistrationDraft("registration-city-user");
  setClerkHomeAirportDraft("registration-city-user", "JFK");
  assert.deepEqual(getClerkProfileRegistrationDraft("registration-city-user").favoriteCityKeys, retained.favoriteCityKeys);
});

test("request composition uses date-only DOB, one airport, exact city keys and only contract-supported options", () => {
  const values = {
    firstName: " Avery ",
    lastName: " Passenger ",
    email: "  member@example.test ",
    phoneE164: "+15555550123",
    dob: "1985-04-03",
    gender: "female",
    weightLbs: "142",
  };
  const request = buildClerkProfileUpdateRequest({
    values,
    homeAirportCode: "sfo",
    favoriteCityKeys: ["san-francisco", "new-york-city"],
    catalogKeys: ["san-francisco", "new-york-city"],
    profile: { ...profile, phoneCountry: "US", smsConsent: true },
  });
  assert.deepEqual(request, {
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco", "new-york-city"],
    email: "member@example.test",
    phoneE164: "+15555550123",
    phoneCountry: "US",
    weightLbs: 142,
  });
  assert.equal("notificationPrefs" in request, false);
  assert.equal("smsConsent" in request, false);
  assert.equal("additionalAirportCodes" in request, false);
  assert.throws(() => buildClerkProfileUpdateRequest({
    values: { ...values, email: "" },
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    catalogKeys: ["san-francisco"],
    profile,
  }), /valid email/i);
  assert.throws(() => buildClerkProfileUpdateRequest({
    values,
    homeAirportCode: "SFO",
    favoriteCityKeys: [],
    catalogKeys: ["san-francisco"],
    profile,
  }), /at least one city/i);
});

test("airport and city tabs filter results, scroll, and preserve independent selections", () => {
  assert.deepEqual(getClerkAirportSelectionDraft("member-a", ["sfo", "SFO", "bad code"]), ["SFO"]);
  setClerkAirportSelectionDraft("member-a", ["JFK", "lax", "jfk"]);
  assert.deepEqual(getClerkAirportSelectionDraft("member-a"), ["JFK"]);
  assert.deepEqual(getClerkAirportSelectionDraft("member-b"), []);

  const airports = [
    { code: "SFO", name: "San Francisco International", city: "San Francisco", state: "CA", country: "US" },
    { code: "JFK", name: "John F Kennedy International", city: "New York", state: "NY", country: "US" },
  ];
  assert.deepEqual(filterClerkRegistrationAirports(airports, ""), airports);
  assert.deepEqual(filterClerkRegistrationAirports(airports, "new york"), [airports[1]]);
  assert.deepEqual(
    filterClerkRegistrationAirports([...airports, { ...airports[0], name: "Duplicate SFO" }], "", ["JFK"]),
    [airports[1], airports[0]],
    "selected airports sort first and duplicate airport codes render once",
  );
  assert.deepEqual(
    filterClerkRegistrationAirports(airports, "san francisco", ["JFK"]),
    [airports[0]],
    "airport search only shows matches and does not require the selected airport to match",
  );
  setClerkHomeAirportDraft("member-a", "SFO");
  assert.deepEqual(
    filterClerkRegistrationAirports(airports, "", getClerkAirportSelectionDraft("member-a")),
    [airports[0], airports[1]],
    "the newly selected home airport moves first immediately",
  );
  setClerkHomeAirportDraft("member-a", "JFK");
  assert.deepEqual(getClerkAirportSelectionDraft("member-a"), ["JFK"], "selecting a new airport replaces the home airport");
  const cities = [
    { key: "san-francisco", displayName: "San Francisco", country: "United States" },
    { key: "new-york-city", displayName: "New York City", country: "United States" },
  ];
  assert.deepEqual(filterClerkRegistrationCities(cities, ""), cities);
  assert.deepEqual(filterClerkRegistrationCities(cities, "san-francisco"), [cities[0]]);
  assert.deepEqual(
    filterClerkRegistrationCities(
      [...cities, { ...cities[0], displayName: "Duplicate San Francisco" }],
      "",
      ["new-york-city"],
    ),
    [cities[1], cities[0]],
    "selected cities sort first and duplicate city keys render once",
  );
  assert.deepEqual(
    filterClerkRegistrationCities(cities, "san-francisco", ["new-york-city"]),
    [cities[0]],
    "city search filters rows without removing hidden selections from the draft",
  );
  toggleClerkFavoriteCityDraft("member-a", "san-francisco", cities.map((city) => city.key));
  assert.deepEqual(getClerkProfileRegistrationDraft("member-a").favoriteCityKeys, ["san-francisco"]);
  assert.deepEqual(
    filterClerkRegistrationCities(cities, "", getClerkProfileRegistrationDraft("member-a").favoriteCityKeys),
    [cities[0], cities[1]],
    "the newly selected city moves first immediately",
  );
  toggleClerkFavoriteCityDraft("member-a", "san-francisco", cities.map((city) => city.key));
  assert.deepEqual(filterClerkRegistrationCities(cities, "", getClerkProfileRegistrationDraft("member-a").favoriteCityKeys), cities);
  assert.deepEqual(getClerkAirportSelectionDraft("member-a"), ["JFK"], "changing tabs does not change the chosen airport");

  const airportSource = readFileSync(resolve(projectRoot, "app/airport-picker.tsx"), "utf8");
  for (const identifier of [
    "registration-${tab}-tab",
    "registration-airport-search",
    "registration-city-search",
    "registration-home-airport-${airport.code}",
    "registration-city-${city.key}",
  ]) assert.ok(airportSource.includes(identifier), `missing location control ${identifier}`);
  assert.ok(airportSource.includes("filterClerkRegistrationAirports"));
  assert.ok(airportSource.includes("filterClerkRegistrationCities"));
  assert.ok(airportSource.includes("KeyboardAwareScrollViewCompat"));
  assert.ok(airportSource.includes("setActiveTab(tab)"));
  assert.ok(airportSource.includes("setClerkHomeAirportDraft(clerkUserId, airport.code)"));
  assert.ok(airportSource.includes("toggleClerkFavoriteCityDraft(clerkUserId, city.key, catalogKeys)"));
  assert.ok(airportSource.includes("Continue to Review &amp; Save"));
  assert.ok(airportSource.includes("airportSearchState.kind === 'loading' || citiesQuery.isLoading || citiesQuery.isError"));
  assert.ok(airportSource.includes("citiesQuery.data ?? [],\n    citySearch,\n    draft.favoriteCityKeys"));
  assert.ok(airportSource.includes("!normalizedAirportSearch && draft.homeAirportCode"));
  assert.equal(airportSource.includes("fetchProductionAirports([]"), false);
  assert.ok(airportSource.includes("fetchProductionAirportCities"));
  const reviewSource = readFileSync(resolve(projectRoot, "app/registration-review.tsx"), "utf8");
  assert.ok(reviewSource.includes("ReviewCard title=\"Personal Information\""));
  assert.ok(reviewSource.includes('label="Email"'));
  assert.ok(reviewSource.includes("ReviewCard title=\"Locations\""));
  assert.ok(reviewSource.includes("Confirm & Save"));
  assert.ok(reviewSource.includes("back-from-registration-review"));
  assert.ok(reviewSource.includes("fetchProductionAirports(selectedAirportCodes"));
  assert.ok(reviewSource.includes("[draft.homeAirportCode]"));
  assert.equal(reviewSource.includes("draft.additionalAirportCodes"), false);
  assert.equal(reviewSource.includes("favoriteAirportCodes:"), false);
});

test("only the matching incomplete Clerk identity can open airports and review; tour remains verified", () => {
  const incomplete = { status: "profile_incomplete", clerkUserId: "member-a", currentUser: {} };
  const complete = { status: "profile_complete", clerkUserId: "member-a", currentUser: {} };
  assert.equal(canAccessClerkProfileOnboardingRoute(["airport-picker"], incomplete, "member-a"), true);
  assert.equal(canAccessClerkProfileOnboardingRoute(["registration-review"], incomplete, "member-a"), true);
  assert.equal(canAccessClerkProfileOnboardingRoute(["registration-review"], complete, "member-a"), false);
  assert.equal(canAccessClerkProfileOnboardingRoute(["(auth)", "welcome-tour"], incomplete, "member-a"), true);
  assert.equal(canAccessClerkProfileOnboardingRoute(["(auth)", "welcome-tour"], complete, "member-a"), true);
  assert.equal(canAccessClerkProfileOnboardingRoute(["(tabs)", "discover"], incomplete, "member-a"), false);
  assert.equal(canAccessClerkProfileOnboardingRoute(["airport-picker"], incomplete, "member-b"), false);
  assert.equal(canAccessClerkProfileOnboardingRoute(["airport-picker"], complete, "member-a"), false);
  assert.equal(canAccessClerkProfileOnboardingRoute(["registration-review"], incomplete, "member-b"), false);
  assert.equal(getClerkOnboardingAfterTourDestination(true), "/(tabs)/discover");
  assert.equal(getClerkOnboardingAfterTourDestination(false), "/(auth)/onboarding");
});

test("the saved Clerk completion is consumed by the original three-slide tour before Home", () => {
  const tourSource = readFileSync(resolve(projectRoot, "app/(auth)/welcome-tour.tsx"), "utf8");
  assert.ok(tourSource.includes("getClerkOnboardingAfterTourDestination(clerkFlow)"));
  assert.ok(tourSource.includes("consumeClerkVerifiedRegistrationCompletion"));
  assert.ok(tourSource.includes("if (!clerkFlow && user?.id)"));
  assert.ok(tourSource.includes("confirmClerkProfileCompletion(verifiedUser)"));
});

test("an anonymous-shaped /api/me response does not fetch a profile or imply registration", async () => {
  const api = fakeApi({
    me: currentUser({
      isAuthenticated: false,
      isMember: false,
      isProfileComplete: false,
      needsSignupPhone: false,
    }),
  });
  const result = await loadClerkBluebirdProfile(api);

  assert.equal(result.kind, "api_not_authenticated");
  assert.equal(result.currentUser.isAuthenticated, false);
  assert.equal(result.currentUser.isMember, false);
  assert.equal(result.currentUser.needsSignupPhone, false);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), ["GET /me"]);
  assert.equal(canEditClerkBluebirdProfile(result), false);
});

test("manual registration diagnostic reads the authenticated profile once and never writes", async () => {
  const calls = [];
  const api = {
    getMe: async (options) => {
      calls.push("GET /api/me");
      options?.onResponseStatus?.(200);
      return currentUser({ isProfileComplete: false });
    },
    getProfileDiagnostic: async (options) => {
      calls.push("GET /api/me/profile");
      options?.onResponseStatus?.(200);
      return {
        fields: {
          firstName: "absent",
          lastName: "present",
          dob: "present",
          gender: "present",
          homeAirport: "present",
          favoriteCities: "present",
          email: "absent",
          verifiedPhone: "present",
        },
        profileIsComplete: false,
        emailRequired: true,
        emailLocked: false,
        signupChannel: "phone",
        phoneVerificationRequired: true,
        verifiedPhoneRequirementSatisfied: true,
        upgradeCreditBalances: "missing",
      };
    },
  };
  const result = await diagnoseClerkBluebirdRegistrationProfile(api);
  assert.equal(result.kind, "loaded");
  assert.equal(result.isAuthenticated, true);
  assert.equal(result.isProfileComplete, false);
  assert.equal(result.profile.fields.firstName, "absent");
  assert.equal(result.profile.fields.email, "absent");
  assert.deepEqual(calls, ["GET /api/me", "GET /api/me/profile"]);
  assert.equal(calls.some((call) => call.startsWith("PUT ")), false);
});

test("manual diagnostic does not request profile when /api/me is not authenticated", async () => {
  const calls = [];
  const result = await diagnoseClerkBluebirdRegistrationProfile({
    getMe: async (options) => {
      calls.push("GET /api/me");
      options?.onResponseStatus?.(200);
      return currentUser({ isAuthenticated: false, isProfileComplete: false });
    },
    getProfileDiagnostic: async () => {
      calls.push("GET /api/me/profile");
      throw new Error("must not read profile");
    },
  });
  assert.equal(result.kind, "not_authenticated");
  assert.equal(result.meHttpStatus, 200);
  assert.equal(result.profileHttpStatus, null);
  assert.deepEqual(calls, ["GET /api/me"]);
});

test("profile and /api/me completion disagreement stays unverified and cannot be edited", async () => {
  const api = fakeApi({
    me: currentUser({ isProfileComplete: false, needsSignupPhone: false }),
    loadedProfile: { ...profile, isComplete: true },
  });
  const result = await loadClerkBluebirdProfile(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.completion, "unverified");
  assert.equal(canEditClerkBluebirdProfile(result), false);
  await assert.rejects(
    updateClerkBluebirdProfileExplicitly(api, result, {}),
    /not verified/,
  );
  assert.deepEqual(api.calls.map(({ method }) => method), ["GET", "GET", "GET"]);
});

test("profile completion is based on matching API-owned state, not membership or missing fields", async () => {
  const api = fakeApi({
    me: currentUser({
      isMember: true,
      memberTier: "plus",
      isProfileComplete: true,
      needsSignupPhone: false,
    }),
    loadedMembership: {
      isMember: true,
      tier: "plus",
      cancelAtPeriodEnd: false,
      recentEvents: [],
    },
    loadedProfile: {
      ...profile,
      firstName: "Bluebird",
      lastName: "Member",
      isComplete: true,
    },
  });
  const result = await loadClerkBluebirdProfile(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.completion, "complete");
  assert.equal(result.membershipState, "available");
  assert.equal(getClerkOnboardingStep(result), "complete");
  assert.equal(canEditClerkBluebirdProfile(result), true);
});

test("membership decision is not a profile or registration step", async () => {
  const api = fakeApi({
    me: currentUser({ isProfileComplete: true, needsPlanDecision: true }),
    loadedProfile: { ...profile, isComplete: true },
  });
  const result = await loadClerkBluebirdProfile(api);
  assert.equal(result.currentUser.isMember, false);
  assert.equal(result.completion, "complete");
  assert.equal(getClerkOnboardingStep(result), "complete");
  assert.equal(canEditClerkBluebirdProfile(result), true);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /me/profile",
    "GET /membership",
  ]);
});

test("a returning complete nonmember stays on the account path when no plan decision is required", async () => {
  const result = await loadClerkBluebirdProfile(fakeApi({
    me: currentUser({
      isMember: false,
      memberTier: null,
      isProfileComplete: true,
      needsPlanDecision: false,
      needsSignupPhone: false,
    }),
    loadedProfile: {
      ...profile,
      firstName: "Returning",
      lastName: "User",
      isComplete: true,
    },
  }));

  assert.equal(result.kind, "authenticated");
  assert.equal(result.currentUser.isMember, false);
  assert.equal(result.completion, "complete");
  assert.equal(result.membershipState, "available");
  assert.equal(getClerkOnboardingStep(result), "complete");
  assert.equal(canEditClerkBluebirdProfile(result), true);
});

test("membership errors and contradictory fields do not change profile completion", async () => {
  const unavailable = await loadClerkBluebirdProfile(fakeApi({
    me: currentUser({ isProfileComplete: true }),
    loadedProfile: { ...profile, isComplete: true },
    membershipError: new Error("membership unavailable"),
  }));
  assert.equal(unavailable.kind, "authenticated");
  assert.equal(unavailable.membershipState, "unavailable");
  assert.equal(getClerkOnboardingStep(unavailable), "complete");
  assert.equal(canEditClerkBluebirdProfile(unavailable), true);

  const mismatch = await loadClerkBluebirdProfile(fakeApi({
    me: currentUser({ isProfileComplete: true, isMember: false, memberTier: null }),
    loadedProfile: { ...profile, isComplete: true },
    loadedMembership: {
      isMember: true,
      tier: "plus",
      cancelAtPeriodEnd: false,
      recentEvents: [],
    },
  }));
  assert.equal(mismatch.membershipState, "conflict");
  assert.equal(getClerkOnboardingStep(mismatch), "complete");
});

test("only an explicit editable-profile update calls PUT and returns API values", async () => {
  const api = fakeApi({
    updateResult: {
      ...currentUser(),
      firstName: "Updated",
      lastName: "Name",
    },
  });
  const result = await loadClerkBluebirdProfile(api);
  const update = {
    firstName: "Updated",
    lastName: "Name",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    phoneE164: "+14155550123",
    phoneCountry: "US",
  };

  const saved = await updateClerkBluebirdProfileExplicitly(api, result, update);
  assert.equal(saved.firstName, "Updated");
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /me/profile",
    "GET /membership",
    "PUT /me/profile",
  ]);
  assert.deepEqual(api.calls[3].data, update);
});

test("registration sends one explicit update and continues only when authenticated /me confirms completion", async () => {
  const api = fakeApi({ updateResult: currentUser({ firstName: "Avery" }) });
  api.getMe = async (options) => {
    api.calls.push({ method: "GET", path: "/me", options });
    options?.onResponseStatus?.(200);
    return currentUser({ isProfileComplete: true, needsSignupPhone: false });
  };
  const result = await loadClerkBluebirdProfile(fakeApi());
  const request = {
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    weightLbs: 142,
  };

  const saved = await saveClerkBluebirdRegistration(api, result, request);
  assert.equal(saved.currentUser.isAuthenticated, true);
  assert.equal(saved.currentUser.isProfileComplete, true);
  assert.equal(saved.updatedCurrentUser.firstName, "Avery");
  assert.equal(saved.weightSaved, false, "CurrentUser does not confirm profile weight");
  assert.deepEqual(saved.diagnostic, {
    writeEndpoint: "/api/me/profile",
    writeHttpStatus: 200,
    writeResponse: "valid",
    writeResponseIssue: null,
    verificationEndpoint: "/api/me",
    verificationHttpStatus: 200,
    verificationReadFailed: false,
    isAuthenticated: true,
    isProfileComplete: true,
    emailPresent: false,
  });
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "PUT /me/profile",
    "GET /me",
  ]);
  assert.deepEqual(api.calls[0].data, request);
});

test("malformed successful CurrentUser responses stay malformed and are checked once through authenticated /me", async () => {
  const calls = [];
  const api = fakeApi();
  api.updateProfile = async (data, options) => {
    calls.push({ method: "PUT", data });
    options?.onResponseStatus?.(200);
    const error = new Error("currentUser.isAdmin");
    error.code = "invalid_schema";
    error.field = "currentUser.isAdmin";
    throw error;
  };
  api.getMe = async (options) => {
    calls.push({ method: "GET" });
    options?.onResponseStatus?.(200);
    return currentUser({ isProfileComplete: true });
  };
  const result = await loadClerkBluebirdProfile(fakeApi());
  const saved = await saveClerkBluebirdRegistration(api, result, {
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
  });

  assert.equal(saved.updatedCurrentUser, null, "a malformed CurrentUser projection is never replaced with a fabricated default");
  assert.equal(saved.diagnostic.writeEndpoint, "/api/me/profile");
  assert.equal(saved.diagnostic.writeHttpStatus, 200);
  assert.equal(saved.diagnostic.writeResponse, "malformed");
  assert.equal(saved.diagnostic.writeResponseIssue, "currentUser.isAdmin");
  assert.equal(saved.diagnostic.verificationEndpoint, "/api/me");
  assert.equal(saved.diagnostic.verificationHttpStatus, 200);
  assert.equal(saved.diagnostic.verificationReadFailed, false);
  assert.equal(saved.diagnostic.isProfileComplete, true);
  assert.deepEqual(getClerkRegistrationWriteOutcome(saved.diagnostic), {
    kind: "malformed_response",
    httpStatus: 200,
    issue: "currentUser.isAdmin",
  });
  assert.equal(getClerkRegistrationCompletionCheck(saved.diagnostic).kind, "confirmed_complete");
  assert.deepEqual(calls.map(({ method }) => method), ["PUT", "GET"]);
  assert.equal(calls.filter(({ method }) => method === "PUT").length, 1);
});

test("a malformed successful write is not accepted when /api/me does not confirm completion", async () => {
  const calls = [];
  const api = fakeApi();
  api.updateProfile = async (_data, options) => {
    calls.push("PUT");
    options?.onResponseStatus?.(200);
    const error = new Error("currentUser.isAdmin");
    error.code = "invalid_schema";
    error.field = "currentUser.isAdmin";
    throw error;
  };
  api.getMe = async (options) => {
    calls.push("GET");
    options?.onResponseStatus?.(200);
    return currentUser({ isProfileComplete: false });
  };
  const result = await loadClerkBluebirdProfile(fakeApi());
  await assert.rejects(
    saveClerkBluebirdRegistration(api, result, {
      firstName: "Avery",
      lastName: "Passenger",
      dob: "1985-04-03",
      gender: "female",
      homeAirportCode: "SFO",
      favoriteCityKeys: ["san-francisco"],
    }),
    (error) => error instanceof ClerkRegistrationCompletionError &&
      error.diagnostic.writeResponse === "malformed" &&
      error.diagnostic.writeResponseIssue === "currentUser.isAdmin" &&
      error.diagnostic.isProfileComplete === false &&
      error.diagnostic.emailPresent === false &&
      getClerkRegistrationCompletionCheck(error.diagnostic).emailMissing === true,
  );
  assert.deepEqual(calls, ["PUT", "GET"]);
});

test("registration trusts only authenticated complete /me and retains the form for incomplete or uncertain state", async () => {
  const initialApi = fakeApi();
  const result = await loadClerkBluebirdProfile(initialApi);
  const request = {
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
  };

  const incompleteProfileApi = fakeApi({
    updateResult: currentUser({ isProfileComplete: false }),
  });
  incompleteProfileApi.getMe = async () => currentUser({ isProfileComplete: true });
  const completionFromMe = await saveClerkBluebirdRegistration(incompleteProfileApi, result, request);
  assert.equal(completionFromMe.currentUser.isProfileComplete, true);

  const incompleteProjectionApi = fakeApi({
    updateResult: currentUser({ isProfileComplete: true }),
  });
  incompleteProjectionApi.getMe = async () => currentUser({ isProfileComplete: false });
  await assert.rejects(
    saveClerkBluebirdRegistration(incompleteProjectionApi, result, request),
    ClerkRegistrationCompletionError,
  );

  const unauthenticatedApi = fakeApi({
    updateResult: currentUser({ isProfileComplete: true }),
  });
  unauthenticatedApi.getMe = async () => currentUser({
    isAuthenticated: false,
    isProfileComplete: true,
  });
  await assert.rejects(
    saveClerkBluebirdRegistration(unauthenticatedApi, result, request),
    ClerkRegistrationCompletionError,
  );

  const failedRefreshApi = fakeApi({
    updateResult: currentUser({ isProfileComplete: true }),
  });
  failedRefreshApi.getMe = async (options) => {
    failedRefreshApi.calls.push({ method: "GET", path: "/me", options });
    throw new Error("refresh unavailable");
  };
  await assert.rejects(
    saveClerkBluebirdRegistration(failedRefreshApi, result, request),
    (error) => error instanceof ClerkRegistrationCompletionError &&
      error.diagnostic.verificationHttpStatus === null &&
      error.diagnostic.verificationReadFailed === true,
  );
  assert.deepEqual(failedRefreshApi.calls.map(({ method, path }) => `${method} ${path}`), [
    "PUT /me/profile",
    "GET /me",
  ]);

  const rejectedWeightApi = fakeApi({
    updateResult: currentUser({ isProfileComplete: true }),
  });
  rejectedWeightApi.getMe = async () => currentUser({ isProfileComplete: true });
  const weightResult = await saveClerkBluebirdRegistration(
    rejectedWeightApi,
    result,
    { ...request, weightLbs: 142 },
  );
  assert.equal(weightResult.weightSaved, false);
});

test("a failed registration save leaves all identity-scoped selections and form values intact", async () => {
  const userId = "registration-save-error-user";
  const before = {
    ...getClerkProfileRegistrationDraft(userId),
    values: {
      firstName: "Avery",
      lastName: "Passenger",
      email: "avery@example.test",
      phoneE164: "+15555550123",
      dob: "1985-04-03",
      gender: "female",
      weightLbs: "142",
    },
    homeAirportCode: "SFO",
    additionalAirportCodes: ["JFK", "LAX"],
    favoriteCityKeys: ["san-francisco"],
  };
  setClerkProfileRegistrationDraft(userId, before);
  const api = fakeApi();
  api.updateProfile = async (data, options) => {
    api.calls.push({ method: "PUT", path: "/me/profile", data, options });
    throw new Error("temporary save failure");
  };
  const result = await loadClerkBluebirdProfile(fakeApi());
  const request = {
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
  };
  await assert.rejects(
    saveClerkBluebirdRegistration(api, result, request),
    (error) => error instanceof ClerkRegistrationCompletionError &&
      error.diagnostic.writeResponse === "failed" &&
      error.diagnostic.isProfileComplete === false,
  );
  assert.deepEqual(getClerkProfileRegistrationDraft(userId), before);
  const status = await checkClerkBluebirdRegistrationStatus(api);
  assert.equal(status.kind, "incomplete");
  assert.deepEqual(getClerkProfileRegistrationDraft(userId), before, "read-only recovery keeps the identity-scoped form and selections");
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "PUT /me/profile",
    "GET /me",
    "GET /me",
  ]);
  assert.equal(api.calls.filter(({ method }) => method === "PUT").length, 1, "a status check never resends the profile");
});

test("registration diagnostics separate an HTTP rejection from an unknown timeout outcome", async () => {
  const initial = await loadClerkBluebirdProfile(fakeApi());
  const request = {
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
  };

  const rejectedApi = fakeApi();
  rejectedApi.updateProfile = async (_data, options) => {
    rejectedApi.calls.push({ method: "PUT", path: "/me/profile", options });
    options?.onResponseStatus?.(422);
    const error = new Error("request rejected");
    error.code = "http";
    error.status = 422;
    throw error;
  };
  await assert.rejects(
    saveClerkBluebirdRegistration(rejectedApi, initial, request),
    (error) => error instanceof ClerkRegistrationCompletionError &&
      getClerkRegistrationWriteOutcome(error.diagnostic).kind === "rejected" &&
      getClerkRegistrationCompletionCheck(error.diagnostic).kind === "incomplete",
  );
  assert.deepEqual(rejectedApi.calls.map(({ method, path }) => `${method} ${path}`), [
    "PUT /me/profile",
    "GET /me",
  ]);
  assert.equal(rejectedApi.calls.filter(({ method }) => method === "PUT").length, 1);

  const unknownApi = fakeApi();
  unknownApi.updateProfile = async (_data, options) => {
    unknownApi.calls.push({ method: "PUT", path: "/me/profile", options });
    const error = new Error("request timed out");
    error.code = "timeout";
    throw error;
  };
  unknownApi.getMe = async (options) => {
    unknownApi.calls.push({ method: "GET", path: "/me", options });
    throw new Error("verification unavailable");
  };
  await assert.rejects(
    saveClerkBluebirdRegistration(unknownApi, initial, request),
    (error) => error instanceof ClerkRegistrationCompletionError &&
      getClerkRegistrationWriteOutcome(error.diagnostic).kind === "unknown" &&
      getClerkRegistrationCompletionCheck(error.diagnostic).kind === "unavailable",
  );
  assert.deepEqual(unknownApi.calls.map(({ method, path }) => `${method} ${path}`), [
    "PUT /me/profile",
    "GET /me",
  ]);
  assert.equal(unknownApi.calls.filter(({ method }) => method === "PUT").length, 1);
});

test("registration recovery status is read-only and only authenticated complete /me permits continuation", async () => {
  for (const [projection, expected] of [
    [currentUser({ isProfileComplete: true }), "confirmed_complete"],
    [currentUser({ isProfileComplete: false }), "incomplete"],
    [currentUser({ isAuthenticated: false, isProfileComplete: true }), "unauthenticated"],
  ]) {
    const api = fakeApi({ me: projection });
    const status = await checkClerkBluebirdRegistrationStatus(api);
    assert.equal(status.kind, expected);
    if (expected === "incomplete") {
      assert.equal(status.emailMissing, true, "the /me projection identifies a missing email blocker");
    }
    assert.equal(status.httpStatus, 200);
    assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), ["GET /me"]);
    assert.equal(api.calls.filter(({ method }) => method === "PUT").length, 0);
    assert.equal(api.calls.some(({ path }) => path === "/me/profile"), false);
  }

  const failedApi = fakeApi();
  failedApi.getMe = async (options) => {
    failedApi.calls.push({ method: "GET", path: "/me", options });
    throw new Error("read unavailable");
  };
  const failed = await checkClerkBluebirdRegistrationStatus(failedApi);
  assert.deepEqual(failed, { kind: "unavailable", httpStatus: null });
  assert.deepEqual(failedApi.calls.map(({ method, path }) => `${method} ${path}`), ["GET /me"]);
  assert.equal(failedApi.calls.filter(({ method }) => method === "PUT").length, 0);
});

test("only matching API-confirmed registration completion is available to the tour", () => {
  const completeMe = currentUser({ isProfileComplete: true });
  assert.equal(setClerkVerifiedRegistrationCompletion("tour-user-a", completeMe), true);
  assert.equal(consumeClerkVerifiedRegistrationCompletion("tour-user-b"), null);
  assert.deepEqual(consumeClerkVerifiedRegistrationCompletion("tour-user-a"), completeMe);
  assert.equal(consumeClerkVerifiedRegistrationCompletion("tour-user-a"), null);
  assert.equal(setClerkVerifiedRegistrationCompletion("tour-user-a", currentUser({
    isProfileComplete: false,
  })), false);
});

test("stale and cancelled profile responses are discarded when the Clerk identity changes", () => {
  assert.equal(isClerkBluebirdProfileResultCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-a",
    aborted: false,
  }), true);
  assert.equal(isClerkBluebirdProfileResultCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-b",
    aborted: false,
  }), false);
  assert.equal(isClerkBluebirdProfileResultCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-a",
    aborted: true,
  }), false);
});

test("API errors are not converted into anonymous or registration-required states", async () => {
  const api = fakeApi();
  api.getMe = async () => { throw new Error("API unavailable"); };
  await assert.rejects(loadClerkBluebirdProfile(api), /API unavailable/);
  assert.deepEqual(api.calls, []);
});

test("profile loading stays stable across equivalent rerenders and reloads only for retry or identity changes", async () => {
  const configuration = {
    environment: "development",
    apiBaseUrl: "https://development.example/api",
    clerkPublishableKey: "pk_test_abcdefghijkl",
  };
  const getToken = async () => "session-token";
  const session = {
    isLoaded: true,
    isSignedIn: true,
    userId: "clerk-user-a",
    getToken,
    signOut: async () => {},
  };
  const api = fakeApi();
  let previousDependencies;
  let loadCount = 0;

  async function simulateProfileEffect(nextConfiguration, nextSession, loadAttempt) {
    const dependencies = getClerkBluebirdProfileEffectDependencies({
      configuration: nextConfiguration,
      session: nextSession,
      loadAttempt,
    });
    const changed = !previousDependencies ||
      dependencies.length !== previousDependencies.length ||
      dependencies.some((dependency, index) => !Object.is(dependency, previousDependencies[index]));
    if (!changed) return;

    previousDependencies = dependencies;
    loadCount += 1;
    await loadClerkBluebirdProfile(api);
  }

  await simulateProfileEffect(configuration, session, 0);
  for (let render = 0; render < 20; render += 1) {
    await simulateProfileEffect({ ...configuration }, { ...session }, 0);
  }
  assert.equal(loadCount, 1);
  assert.equal(api.calls.filter(({ path }) => path === "/me/profile").length, 1);

  await simulateProfileEffect(
    { ...configuration },
    { ...session, getToken: async () => "refreshed-session-token" },
    0,
  );
  assert.equal(loadCount, 1);
  assert.equal(api.calls.filter(({ path }) => path === "/me/profile").length, 1);

  await simulateProfileEffect({ ...configuration }, { ...session }, 1);
  assert.equal(loadCount, 2);
  assert.equal(api.calls.filter(({ path }) => path === "/me/profile").length, 2);

  await simulateProfileEffect(
    { ...configuration },
    { ...session, userId: "clerk-user-b" },
    1,
  );
  assert.equal(loadCount, 3);
  assert.equal(api.calls.filter(({ path }) => path === "/me/profile").length, 3);
});
