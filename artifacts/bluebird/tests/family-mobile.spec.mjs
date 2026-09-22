import { expect, test } from "@playwright/test";

const primaryUser = {
  id: "user-primary",
  name: "Primary Holder",
  email: "primary@example.test",
  membershipTier: "concierge",
  linePassCount: 0,
  homeAirports: ["BFI"],
};

const linkedUser = {
  id: "user-linked",
  name: "Linked Member",
  email: "linked@example.test",
  membershipTier: "plus",
  linePassCount: 0,
  homeAirports: ["BFI"],
};

function makeFamily(role = "primary", options = {}) {
  const linkedMember = {
    id: "member-linked",
    userId: "user-linked",
    email: linkedUser.email,
    name: linkedUser.name,
    role: "member",
    status: "active",
    allocatedPasses: options.linkedAllocation ?? 2,
    usedPasses: options.linkedUsed ?? 0,
    availablePasses: options.linkedAvailable ?? options.linkedAllocation ?? 2,
    joinedAt: "2026-01-01T00:00:00.000Z",
  };
  const invitedMember = {
    id: "member-invited",
    userId: null,
    email: "new-member@example.test",
    name: null,
    role: "member",
    status: options.invitedStatus ?? "pending",
    allocatedPasses: 0,
    usedPasses: 0,
    availablePasses: 0,
    joinedAt: null,
  };
  const family = {
    id: "family-1",
    role,
    status: options.status ?? "active",
    primaryUserId: primaryUser.id,
    renewalDate: options.renewalDate ?? "2027-01-01",
    memberLimit: 4,
    passTotal: 7,
    pool: {
      total: 7,
      allocated: (options.linkedAllocation ?? 2) + 0,
      available: 7,
      unallocated: 5,
      used: options.linkedUsed ?? 0,
    },
    members: role === "primary" ? [
      {
        id: "member-primary",
        userId: primaryUser.id,
        email: primaryUser.email,
        name: primaryUser.name,
        role: "primary",
        status: "active",
        allocatedPasses: 5,
        usedPasses: 0,
        availablePasses: 5,
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
      linkedMember,
    ] : [linkedMember],
    pendingInvitations: options.pendingInvitations ?? [],
  };
  return family;
}

function makeMembership(user, family, pendingTier) {
  return {
    tier: user.membershipTier,
    plans: [
      {
        id: "concierge",
        label: "Family/Corporate",
        priceAnnualUsd: 12000,
        membershipCount: 4,
        sharedAnnualPasses: 7,
      },
    ],
    family,
    linePassCount: user.linePassCount,
    renewalDate: family.renewalDate,
    ...(pendingTier ? { pendingTier } : {}),
    features: ["Family/Corporate"],
    totalSavedUsd: 0,
    lifetimeCompletedFlights: 0,
    annualFlightAllowance: 12,
    flightsThisYear: 0,
  };
}

async function signIn(page, user) {
  await page.addInitScript(({ user }) => {
    localStorage.setItem("bluebird_token", "mobile-family-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { user });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: user }));
}

async function mockFamilyApi(page, { user, family, pendingTier, inviteResponse, acceptResponse, acceptError } = {}) {
  let currentFamily = family;
  let currentMembership = makeMembership(user, currentFamily, pendingTier);
  const state = { lastAllocation: null };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/auth/me") {
      return route.fulfill({ json: user });
    }
    if (request.method() === "GET" && path === "/api/queue/status") {
      return route.fulfill({ json: [] });
    }
    if (request.method() === "GET" && path === "/api/notifications") {
      return route.fulfill({ json: [] });
    }
    if (request.method() === "GET" && path === "/api/membership") {
      return route.fulfill({ json: currentMembership });
    }
    if (request.method() === "GET" && path === "/api/membership/family") {
      return route.fulfill({ json: currentFamily });
    }
    if (request.method() === "POST" && path === "/api/membership/family/invitations") {
      const body = request.postDataJSON();
      if (inviteResponse?.error) {
        return route.fulfill({ status: inviteResponse.status ?? 409, json: inviteResponse.error });
      }
      const invitation = inviteResponse?.invitation ?? {
        id: "invitation-1",
        memberId: "member-invited",
        email: body.email,
        expiresAt: "2026-10-01T00:00:00.000Z",
        acceptanceToken: "invite-token",
        acceptancePath: "/join/family/invite-token",
      };
      currentFamily = {
        ...currentFamily,
        pendingInvitations: [invitation],
      };
      currentMembership = makeMembership(user, currentFamily, pendingTier);
      return route.fulfill({
        json: { status: inviteResponse?.status ?? "invited", invitation, family: currentFamily },
      });
    }
    if (request.method() === "PATCH" && path.startsWith("/api/membership/family/members/")) {
      const body = request.postDataJSON();
      state.lastAllocation = body;
      const memberId = path.split("/").pop();
      currentFamily = {
        ...currentFamily,
        members: currentFamily.members.map((member) =>
          member.id === memberId
            ? { ...member, allocatedPasses: body.allocatedPasses, availablePasses: body.allocatedPasses - member.usedPasses }
            : member,
        ),
        pool: {
          ...currentFamily.pool,
          allocated: currentFamily.members
            .filter((member) => member.id !== "member-primary" && member.id !== memberId)
            .reduce((total, member) => total + member.allocatedPasses, 0) + body.allocatedPasses,
          unallocated: 7 - body.allocatedPasses,
        },
      };
      currentMembership = makeMembership(user, currentFamily, pendingTier);
      return route.fulfill({ json: currentFamily });
    }
    if (request.method() === "POST" && path.startsWith("/api/membership/family/invitations/")) {
      if (acceptError) {
        return route.fulfill({ status: acceptError.status, json: acceptError.body });
      }
      return route.fulfill({ json: acceptResponse ?? { status: "accepted", family: currentFamily } });
    }
    return route.continue();
  });
  return state;
}

test("primary holder can open Family management, invite a member, and reallocate passes", async ({ page }) => {
  const family = makeFamily("primary", { linkedAllocation: 1 });
  await signIn(page, primaryUser);
  const apiState = await mockFamilyApi(page, { user: primaryUser, family });

  await page.goto("/membership");
  await expect(page.getByText("Manage Family/Corporate", { exact: true })).toBeVisible();
  await page.getByText("Manage Family/Corporate", { exact: true }).click();
  await expect(page).toHaveURL(/\/membership\/family$/);
  await expect(page.getByText("You are the primary holder.")).toBeVisible();
  await expect(page.getByText("Members (2/4)", { exact: true })).toBeVisible();

  await page.getByPlaceholder("member@example.com").fill("new-member@example.test");
  await page.getByText("Create invitation", { exact: true }).click();
  await expect(page.getByText("Invitation created. Share the acceptance link with the invited member.")).toBeVisible();
  await expect(page.getByText("Invitation pending", { exact: true })).toBeVisible();

  await page.getByText("+", { exact: true }).click();
  await expect(page.getByText("Family pass allocation updated.", { exact: true })).toBeVisible();
  await expect.poll(() => apiState.lastAllocation?.allocatedPasses).toBe(2);
});

test("linked member sees only their relationship and no owner controls", async ({ page }) => {
  const family = makeFamily("member", { linkedAllocation: 2 });
  await signIn(page, linkedUser);
  await mockFamilyApi(page, { user: linkedUser, family });

  await page.goto("/membership");
  await expect(page.getByText("View Family/Corporate", { exact: true })).toBeVisible();
  await page.getByText("View Family/Corporate", { exact: true }).click();
  await expect(page.getByText("Your Family membership", { exact: true })).toBeVisible();
  await expect(page.getByText("Linked Member", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Primary Holder", { exact: true })).not.toBeVisible();
  await expect(page.getByPlaceholder("member@example.com")).not.toBeVisible();
  await expect(page.getByText("Create invitation", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Link existing account", { exact: true })).not.toBeVisible();
});

test("invitation acceptance returns to Family management", async ({ page }) => {
  const family = makeFamily("member", { linkedAllocation: 1 });
  await signIn(page, linkedUser);
  await mockFamilyApi(page, {
    user: linkedUser,
    family,
    acceptResponse: { status: "accepted", family },
  });

  await page.goto("/join/family/invite-token");
  await expect(page.getByText("Join Family/Corporate", { exact: true })).toBeVisible();
  await page.getByText("Accept invitation", { exact: true }).click();
  await expect(page).toHaveURL(/\/membership\/family$/);
  await expect(page.getByText("Your Family membership", { exact: true })).toBeVisible();
});

test("expired invitations and existing-membership conflicts are visible on mobile", async ({ page }) => {
  await signIn(page, linkedUser);
  const expiredFamily = makeFamily("member");
  await mockFamilyApi(page, {
    user: linkedUser,
    family: expiredFamily,
    acceptError: {
      status: 410,
      body: { error: "This Family invitation has expired or was already used", code: "FAMILY_INVITATION_EXPIRED" },
    },
  });
  await page.goto("/join/family/expired-token");
  await page.getByText("Accept invitation", { exact: true }).click();
  await expect(page.getByText("This Family invitation has expired or was already used", { exact: true })).toBeVisible();

  await page.unroute("**/api/**");
  const primaryFamily = makeFamily("primary");
  await signIn(page, primaryUser);
  await mockFamilyApi(page, {
    user: primaryUser,
    family: primaryFamily,
    inviteResponse: {
      status: 409,
      error: {
        error: "This account has an existing membership and needs staff review before it can join the Family plan",
        code: "FAMILY_MEMBERSHIP_CONFLICT",
      },
    },
  });
  await page.goto("/membership/family");
  await page.getByPlaceholder("member@example.com").fill("conflict@example.test");
  await page.getByText("Create invitation", { exact: true }).click();
  await expect(page.getByText("This account has an existing membership and needs staff review before it can join the Family plan", { exact: true })).toBeVisible();
});

test("primary holder sees a clear capacity error when Family is full", async ({ page }) => {
  await signIn(page, primaryUser);
  await mockFamilyApi(page, {
    user: primaryUser,
    family: makeFamily("primary"),
    inviteResponse: {
      status: 409,
      error: {
        error: "This Family/Corporate plan already has four people",
        code: "FAMILY_CAPACITY_REACHED",
      },
    },
  });

  await page.goto("/membership/family");
  await page.getByPlaceholder("member@example.com").fill("another-member@example.test");
  await page.getByText("Create invitation", { exact: true }).click();
  await expect(page.getByText("This Family/Corporate plan already has four people", { exact: true })).toBeVisible();
});

test("renewal and cancellation messaging stays visible from membership", async ({ page }) => {
  const family = makeFamily("primary", { status: "ending", renewalDate: "2026-12-31" });
  await signIn(page, primaryUser);
  await mockFamilyApi(page, { user: primaryUser, family, pendingTier: "cancelled" });

  await page.goto("/membership");
  await expect(page.getByText("Membership cancels on 2026-12-31", { exact: true })).toBeVisible();
  await expect(page.getByText("You keep your Family/Corporate benefits until then. Tap to review or keep your plan.", { exact: true })).toBeVisible();
  await page.getByText("Manage Family/Corporate", { exact: true }).click();
  await expect(page.getByText("Unused passes expire at renewal. If the plan ends, linked members lose Family access.", { exact: true })).toBeVisible();
});