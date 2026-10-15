import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditClerkBluebirdProfile,
  getClerkOnboardingStep,
  getClerkBluebirdProfileEffectDependencies,
  isClerkBluebirdProfileResultCurrent,
  loadClerkBluebirdProfile,
  saveClerkBluebirdRegistration,
  ClerkRegistrationCompletionError,
  updateClerkBluebirdProfileExplicitly,
} from "../scripts/.clerk-bluebird-profile.test.mjs";
import {
  CLERK_PROFILE_SAVE_LIMITATION,
  buildClerkProfileUpdateRequest,
  canAccessClerkProfileOnboardingRoute,
  getClerkProfileRegistrationDraft,
  getVerifiedClerkPhoneNumber,
  getClerkAirportSelectionDraft,
  getClerkOnboardingAfterTourDestination,
  prefillClerkProfileForm,
  consumeClerkVerifiedRegistrationCompletion,
  setClerkHomeAirportDraft,
  setClerkPreferredCityConfirmed,
  setClerkPreferredCityDraft,
  setClerkProfileFormDraft,
  setClerkProfileRegistrationDraft,
  setClerkRegistrationProfileResult,
  setClerkVerifiedRegistrationCompletion,
  suggestClerkPreferredCity,
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
  updateResult = profile,
} = {}) {
  const calls = [];
  return {
    calls,
    getMe: async (options) => {
      calls.push({ method: "GET", path: "/me", options });
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
      return updateResult;
    },
  };
}

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

test("profile form prefills only the requested fields and uses Clerk's verified phone", () => {
  const saved = {
    ...profile,
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    phoneE164: "+15555550111",
    weightLbs: 142,
  };
  assert.deepEqual(prefillClerkProfileForm(saved, "+15555550123"), {
    firstName: "Avery",
    lastName: "Passenger",
    phoneE164: "+15555550123",
    dob: "1985-04-03",
    gender: "female",
    weightLbs: "142",
  });
  assert.deepEqual(prefillClerkProfileForm(profile, null), {
    firstName: "",
    lastName: "",
    phoneE164: "",
    dob: "",
    gender: null,
    weightLbs: "",
  });
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
  assert.match(CLERK_PROFILE_SAVE_LIMITATION, /Preferred City/i);
  assert.match(CLERK_PROFILE_SAVE_LIMITATION, /weight is optional/i);
  const source = readFileSync(resolve(projectRoot, "app/account/bluebird-profile.tsx"), "utf8");
  for (const label of ["First Name", "Last Name", "Phone", "Date of Birth", "Gender", "Weight (lbs)"]) {
    assert.ok(source.includes(label), `profile is missing ${label}`);
  }
  assert.ok(source.includes("Step 1 of 3 · Personal Information"));
  assert.ok(source.includes("Continue to Select Airports"));
  assert.ok(source.includes('keyboardType="number-pad"'), "weight should use the numeric keyboard");
  assert.ok(source.includes("accessibilityState={{ selected: values.gender === gender }}"));
  assert.ok(source.includes("validateClerkProfileForm(values)"));
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
  assert.ok(airportSource.includes("Additional Airports"));
  assert.ok(airportSource.includes("Optional · these selections are for this registration only"));
  assert.ok(airportSource.includes("continue-to-registration-review"));
  assert.ok(airportSource.includes("fetchProductionAirportSearch"));
  assert.equal(airportSource.includes("Favorite Cities"), false);
  assert.equal(airportSource.includes("favoriteCityKeys"), false);
  const reviewSource = readFileSync(resolve(projectRoot, "app/registration-review.tsx"), "utf8");
  assert.ok(reviewSource.includes("STEP 3 OF 3"));
  assert.ok(reviewSource.includes("Review &amp; Save"));
  assert.ok(reviewSource.includes("saveClerkBluebirdRegistration"));
  assert.ok(reviewSource.includes("savingRef.current"));
  assert.ok(reviewSource.includes("confirm-preferred-city"));
  assert.ok(reviewSource.includes("additional-airports-not-saved"));
  assert.ok(reviewSource.includes("weight-save-disclosure"));
  assert.equal(reviewSource.includes("additionalAirportCodes: data"), false);
});

test("registration draft keeps selections by Clerk identity and supports only one home airport", () => {
  const saved = { ...profile, firstName: "Avery", dob: "1985-04-03" };
  const initial = getClerkProfileRegistrationDraft("registration-user-a", saved, "+15555550123");
  assert.equal(initial.values.firstName, "Avery");
  assert.equal(initial.values.dob, "1985-04-03");
  assert.deepEqual(initial.favoriteCityKeys, []);
  setClerkProfileFormDraft("registration-user-a", {
    ...initial.values,
    firstName: "Draft name",
    dob: "1986-02-01",
  });
  setClerkHomeAirportDraft("registration-user-a", "SFO");
  assert.deepEqual(toggleClerkAdditionalAirportDraft("registration-user-a", "JFK"), ["JFK"]);
  assert.deepEqual(toggleClerkAdditionalAirportDraft("registration-user-a", "LAX"), ["JFK", "LAX"]);
  setClerkHomeAirportDraft("registration-user-a", "JFK");
  assert.equal(getClerkProfileRegistrationDraft("registration-user-a").values.firstName, "Draft name");
  assert.deepEqual(getClerkAirportSelectionDraft("registration-user-a"), ["JFK"]);
  assert.deepEqual(getClerkProfileRegistrationDraft("registration-user-a").additionalAirportCodes, ["LAX"]);
  assert.equal(getClerkProfileRegistrationDraft("registration-user-b").values.firstName, "");
  assert.deepEqual(getClerkProfileRegistrationDraft("registration-user-b").favoriteCityKeys, []);
  assert.deepEqual(getClerkProfileRegistrationDraft("registration-user-b").additionalAirportCodes, []);
});

test("preferred city suggestion uses unique catalog airport mappings and selection requires confirmation", () => {
  const canonicalKeys = ["new-york-city", "san-francisco"];
  const cities = [
    { key: "new-york-city", airportCodes: ["JFK", "LGA"] },
    { key: "san-francisco", airportCodes: ["SFO", "OAK"] },
  ];
  assert.equal(suggestClerkPreferredCity("sfo", cities), "san-francisco");
  assert.equal(suggestClerkPreferredCity("JFK", cities), "new-york-city");
  assert.equal(suggestClerkPreferredCity("SEA", cities), null);
  assert.equal(suggestClerkPreferredCity("SFO", [
    ...cities,
    { key: "duplicate-sf-mapping", airportCodes: ["SFO"] },
  ]), null);
  assert.equal(setClerkPreferredCityDraft("registration-city-user", "SFO", canonicalKeys), false);
  assert.equal(setClerkPreferredCityDraft("registration-city-user", "new-york-city", canonicalKeys), true);
  assert.equal(getClerkProfileRegistrationDraft("registration-city-user").preferredCityConfirmed, false);
  setClerkPreferredCityConfirmed("registration-city-user", true);
  assert.equal(getClerkProfileRegistrationDraft("registration-city-user").preferredCityConfirmed, true);
  assert.equal(setClerkPreferredCityDraft("registration-city-user", "san-francisco", canonicalKeys), true);
  assert.equal(getClerkProfileRegistrationDraft("registration-city-user").preferredCityConfirmed, false);
  assert.deepEqual(getClerkProfileRegistrationDraft("registration-city-user").favoriteCityKeys, ["san-francisco"]);
  assert.match(validateClerkAirportCitySelection({
    homeAirportCode: "SFO",
    favoriteCityKeys: ["SFO"],
    catalogKeys: canonicalKeys,
  }), /no longer available/i);
  assert.match(validateClerkAirportCitySelection({
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    catalogKeys: canonicalKeys,
    preferredCityConfirmed: false,
  }), /confirm your Preferred City/i);
  assert.equal(validateClerkAirportCitySelection({
    homeAirportCode: "sfo",
    favoriteCityKeys: ["san-francisco"],
    catalogKeys: canonicalKeys,
    preferredCityConfirmed: true,
  }), null);
});

test("request composition uses date-only DOB, one airport, exact city keys and only contract-supported options", () => {
  const values = {
    firstName: " Avery ",
    lastName: " Passenger ",
    phoneE164: "+15555550123",
    dob: "1985-04-03",
    gender: "female",
    weightLbs: "142",
  };
  const request = buildClerkProfileUpdateRequest({
    values,
    homeAirportCode: "sfo",
    favoriteCityKeys: ["san-francisco"],
    catalogKeys: ["san-francisco"],
    preferredCityConfirmed: true,
    profile: { ...profile, phoneCountry: null },
  });
  assert.deepEqual(request, {
    firstName: "Avery",
    lastName: "Passenger",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    weightLbs: 142,
  });
  assert.equal("email" in request, false);
  assert.equal("phoneE164" in request, false);
  assert.equal("additionalAirportCodes" in request, false);
  assert.throws(() => buildClerkProfileUpdateRequest({
    values,
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    catalogKeys: ["san-francisco"],
    preferredCityConfirmed: false,
    profile,
  }), /confirm your Preferred City/i);
});

test("airport step has searchable single and optional multi-selects; review provides city selection and save", () => {
  assert.deepEqual(getClerkAirportSelectionDraft("member-a", ["sfo", "SFO", "bad code"]), ["SFO"]);
  setClerkAirportSelectionDraft("member-a", ["JFK", "lax", "jfk"]);
  assert.deepEqual(getClerkAirportSelectionDraft("member-a"), ["JFK"]);
  assert.deepEqual(getClerkAirportSelectionDraft("member-b"), []);

  const airportSource = readFileSync(resolve(projectRoot, "app/airport-picker.tsx"), "utf8");
  assert.ok(airportSource.includes("registration-home-airport-search"));
  assert.ok(airportSource.includes("registration-additional-airport-search"));
  assert.ok(airportSource.includes("mode === 'single' ? 'radio' : 'checkbox'"));
  assert.ok(airportSource.includes("mode === 'single' ? { selected } : { checked: selected }"));
  assert.equal(airportSource.includes("Favorite Cities"), false);
  const reviewSource = readFileSync(resolve(projectRoot, "app/registration-review.tsx"), "utf8");
  assert.ok(reviewSource.includes("suggestClerkPreferredCity"));
  assert.ok(reviewSource.includes("fetchProductionAirportCities"));
  assert.ok(reviewSource.includes("preferred-city-search"));
  assert.ok(reviewSource.includes("Confirm &amp; Save"));
  assert.ok(reviewSource.includes("Profile saved, weight not confirmed"));
  assert.ok(reviewSource.includes("additionalAirportCodes"));
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
      ...profile,
      firstName: "Updated",
      lastName: "Name",
      isComplete: true,
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

test("registration sends one explicit update, refreshes /me and only completes when both API projections agree", async () => {
  const savedProfile = { ...profile, isComplete: true, weightLbs: 142 };
  const api = fakeApi({ updateResult: savedProfile });
  api.getMe = async (options) => {
    api.calls.push({ method: "GET", path: "/me", options });
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
  assert.equal(saved.profile.isComplete, true);
  assert.equal(saved.weightSaved, true);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "PUT /me/profile",
    "GET /me",
  ]);
  assert.deepEqual(api.calls[0].data, request);
});

test("registration does not enter the tour for unauthenticated, incomplete or contradictory post-save state", async () => {
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
    updateResult: { ...profile, isComplete: false },
  });
  incompleteProfileApi.getMe = async () => currentUser({ isProfileComplete: true });
  await assert.rejects(
    saveClerkBluebirdRegistration(incompleteProfileApi, result, request),
    ClerkRegistrationCompletionError,
  );

  const incompleteProjectionApi = fakeApi({
    updateResult: { ...profile, isComplete: true },
  });
  incompleteProjectionApi.getMe = async () => currentUser({ isProfileComplete: false });
  await assert.rejects(
    saveClerkBluebirdRegistration(incompleteProjectionApi, result, request),
    ClerkRegistrationCompletionError,
  );

  const unauthenticatedApi = fakeApi({
    updateResult: { ...profile, isComplete: true },
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
    updateResult: { ...profile, isComplete: true },
  });
  failedRefreshApi.getMe = async (options) => {
    failedRefreshApi.calls.push({ method: "GET", path: "/me", options });
    throw new Error("refresh unavailable");
  };
  await assert.rejects(
    saveClerkBluebirdRegistration(failedRefreshApi, result, request),
    /refresh unavailable/,
  );
  assert.deepEqual(failedRefreshApi.calls.map(({ method, path }) => `${method} ${path}`), [
    "PUT /me/profile",
    "GET /me",
  ]);

  const rejectedWeightApi = fakeApi({
    updateResult: { ...profile, isComplete: true, weightLbs: null },
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
      phoneE164: "+15555550123",
      dob: "1985-04-03",
      gender: "female",
      weightLbs: "142",
    },
    homeAirportCode: "SFO",
    additionalAirportCodes: ["JFK", "LAX"],
    favoriteCityKeys: ["san-francisco"],
    preferredCityConfirmed: true,
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
  await assert.rejects(saveClerkBluebirdRegistration(api, result, request), /temporary save failure/);
  assert.deepEqual(getClerkProfileRegistrationDraft(userId), before);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), ["PUT /me/profile"]);
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
