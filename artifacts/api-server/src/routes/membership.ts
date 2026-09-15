import { Router } from "express";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  notificationsTable,
  tripsTable,
  flightsTable,
  familyPlansTable,
  familyMembersTable,
  familyInvitationsTable,
} from "@workspace/db/schema";
import { authMiddleware } from "../middlewares/auth";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import {
  activeFamilyMemberForUser,
  FAMILY_INVITATION_TTL_MS,
  FAMILY_MEMBER_LIMIT,
  FAMILY_PASS_TOTAL,
  hashFamilyToken,
  makeFamilyToken,
  syncFamilyPlans,
} from "../lib/family";

const router = Router();

const MEMBERSHIP_FEATURES: Record<string, string[]> = {
  base: [
    "Browse empty leg flights",
    "Join the queue for any flight",
    "Flight notifications",
    "Unlimited flights",
    "Bring 5 Guests",
  ],
  plus: [
    "Everything in Base",
    "5 Skip the Line passes / month",
    "Priority Access to flights",
    "International flight access",
  ],
  concierge: [
    "Everything in Plus",
    "AI Concierge 24/7",
    "Dedicated flight coordinator",
    "Custom flight requests",
    "7 annual Skip the Line passes",
    "4 memberships in 1",
    "Access to charter flight aviation advisors",
  ],
};

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const TIER_ORDER: Record<string, number> = { none: -1, base: 0, plus: 1, concierge: 2 };

const PLAN_LABELS: Record<string, string> = {
  base: "Base",
  plus: "Plus",
  concierge: "Family/Corporate",
};

// Purchasable plan catalog surfaced to clients. This is the source of truth
// for every membership discovery, paywall, checkout, and manage-plan surface.
const PLAN_CATALOG = [
  { id: "base" as const, label: PLAN_LABELS.base, priceAnnualUsd: 3995, features: MEMBERSHIP_FEATURES.base },
  { id: "plus" as const, label: PLAN_LABELS.plus, priceAnnualUsd: 9995, features: MEMBERSHIP_FEATURES.plus },
  {
    id: "concierge" as const,
    label: PLAN_LABELS.concierge,
    priceAnnualUsd: 13995,
    features: MEMBERSHIP_FEATURES.concierge,
    membershipCount: 4,
    sharedAnnualPasses: 7,
    billingCadence: "annual",
    description: "One primary holder plus up to three linked members. The primary holder allocates one shared pool of seven annual passes.",
  },
];

function renewalDate(): string {
  const renewal = new Date();
  renewal.setFullYear(renewal.getFullYear() + 1);
  return renewal.toISOString().slice(0, 10);
}

// Annual flight allowance per tier (calendar year).
const ANNUAL_FLIGHT_ALLOWANCE: Record<string, number> = { base: 10, plus: 20, concierge: 40 };

async function familySummaryForUser(userId: string, database: any = db) {
  const access = await activeFamilyMemberForUser(userId, database);
  if (!access) return null;
  const allMembers = await database
    .select({
      id: familyMembersTable.id,
      userId: familyMembersTable.userId,
      email: familyMembersTable.email,
      name: usersTable.name,
      role: familyMembersTable.role,
      status: familyMembersTable.status,
      allocatedPasses: familyMembersTable.allocatedPasses,
      usedPasses: familyMembersTable.usedPasses,
      joinedAt: familyMembersTable.joinedAt,
    })
    .from(familyMembersTable)
    .leftJoin(usersTable, eq(familyMembersTable.userId, usersTable.id))
    .where(eq(familyMembersTable.familyPlanId, access.plan.id));
  const visibleMembers = access.member.role === "primary"
    ? allMembers
    : allMembers.filter((member: any) => member.id === access.member.id);
  const activeMembers = allMembers.filter((member: any) => member.status === "active");
  const allocated = activeMembers.reduce((sum: number, member: any) => sum + member.allocatedPasses, 0);
  const used = activeMembers.reduce((sum: number, member: any) => sum + member.usedPasses, 0);
  const pendingInvitations = access.member.role === "primary"
    ? await database
      .select({
        id: familyInvitationsTable.id,
        memberId: familyInvitationsTable.familyMemberId,
        email: familyInvitationsTable.email,
        expiresAt: familyInvitationsTable.expiresAt,
      })
      .from(familyInvitationsTable)
      .where(and(
        eq(familyInvitationsTable.familyPlanId, access.plan.id),
        sql`${familyInvitationsTable.acceptedAt} IS NULL`,
      ))
    : [];
  return {
    id: access.plan.id,
    role: access.member.role,
    status: access.plan.status,
    primaryUserId: access.plan.primaryUserId,
    renewalDate: access.plan.renewalAt.toISOString().slice(0, 10),
    memberLimit: FAMILY_MEMBER_LIMIT,
    passTotal: FAMILY_PASS_TOTAL,
    pool: {
      total: FAMILY_PASS_TOTAL,
      allocated,
      available: FAMILY_PASS_TOTAL - used,
      unallocated: FAMILY_PASS_TOTAL - allocated,
      used,
    },
    members: visibleMembers.map((member: any) => ({
      ...member,
      availablePasses: Math.max(0, member.allocatedPasses - member.usedPasses),
    })),
    pendingInvitations,
  };
}

async function membershipStats(user: { id: string }) {
  const completed = await db
    .select({ priceUsd: flightsTable.priceUsd, departureDate: flightsTable.departureDate, bookedAt: tripsTable.bookedAt })
    .from(tripsTable)
    .innerJoin(flightsTable, eq(tripsTable.flightId, flightsTable.id))
    .where(and(eq(tripsTable.userId, user.id), eq(tripsTable.status, "completed")));

  const totalSavedUsd = completed.reduce((sum, t) => sum + (t.priceUsd ?? 0), 0);
  const lifetimeCompletedFlights = completed.length;

  const year = String(new Date().getFullYear());
  const flightsThisYear = completed.filter(
    (t) => (t.departureDate ?? "").startsWith(year) || t.bookedAt.getFullYear().toString() === year
  ).length;

  return {
    totalSavedUsd,
    lifetimeCompletedFlights,
    flightsThisYear,
  };
}

async function membershipPayload(user: {
  id: string;
  membershipTier: string;
  linePassCount: number;
  pendingTier: string | null;
  referralCode: string;
}) {
  await syncFamilyPlans();
  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  const effectiveUser = freshUser ?? user;
  const tier = effectiveUser.membershipTier as "none" | "base" | "plus" | "concierge";
  const stats = await membershipStats(effectiveUser);
  const family = await familySummaryForUser(effectiveUser.id);
  return {
    tier,
    linePassCount: effectiveUser.linePassCount,
    features: MEMBERSHIP_FEATURES[tier] ?? [],
    renewalDate: family?.renewalDate ?? renewalDate(),
    annualFlightAllowance: ANNUAL_FLIGHT_ALLOWANCE[tier] ?? 0,
    plans: PLAN_CATALOG,
    ...(family ? { family } : {}),
    ...stats,
    ...(effectiveUser.pendingTier ? { pendingTier: effectiveUser.pendingTier } : {}),
  };
}

// GET /membership
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json(await membershipPayload(user));
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch membership" });
  }
});

// POST /membership/upgrade
// NOTE: This endpoint is demo-only — it upgrades membership without payment verification.
// In production, gate this behind verified billing entitlements before enabling.
router.post("/upgrade", authMiddleware, async (req, res) => {
  if (process.env.DEMO_MODE !== "true" && process.env.NODE_ENV !== "development") {
    return res.status(501).json({
      error: "Membership upgrades require a payment provider integration in production. Set DEMO_MODE=true to enable the demo upgrade flow.",
    });
  }
  const userId = (req as any).userId;
  const { tier } = req.body;

  // "base" is purchasable too — that's how a non-member joins Bluebird.
  if (!tier || !["base", "plus", "concierge"].includes(tier)) {
    return res.status(400).json({ error: "Invalid tier. Choose 'base', 'plus' or 'concierge'" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    if (TIER_ORDER[tier] <= (TIER_ORDER[user.membershipTier] ?? -1)) {
      return res.status(400).json({ error: "You can only upgrade to a higher tier than your current plan" });
    }

    const wasNonMember = user.membershipTier === "none";
    // Family passes live in family_members and must never be added to the
    // purchaser's personal balance.
    const bonusPasses = tier === "base" ? 0 : tier === "plus" ? 5 : 0;
    const [updated] = await db
      .update(usersTable)
      .set({
        membershipTier: tier,
        linePassCount: sql`${usersTable.linePassCount} + ${bonusPasses}`,
        pendingTier: null,
      })
      .where(eq(usersTable.id, userId))
      .returning();
    if (!updated) return res.status(404).json({ error: "User not found" });

    if (tier === "concierge") {
      const existingPlan = await db
        .select({ id: familyPlansTable.id })
        .from(familyPlansTable)
        .where(eq(familyPlansTable.primaryUserId, userId));
      if (existingPlan.length === 0) {
        const planId = makeId();
        const renewalAt = new Date();
        renewalAt.setFullYear(renewalAt.getFullYear() + 1);
        await db.insert(familyPlansTable).values({
          id: planId,
          primaryUserId: userId,
          status: "active",
          passTotal: FAMILY_PASS_TOTAL,
          renewalAt,
        });
        await db.insert(familyMembersTable).values({
          id: makeId(),
          familyPlanId: planId,
          userId,
          email: (user.email ?? "").trim().toLowerCase(),
          role: "primary",
          status: "active",
          allocatedPasses: FAMILY_PASS_TOTAL,
          previousMembershipTier: user.membershipTier,
          joinedAt: new Date(),
        });
      }
    }

    const label = PLAN_LABELS[tier];
    await db.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: `Welcome to ${label}! ✨`,
      body: tier === "concierge"
        ? "Your Family/Corporate membership is active. Allocate the shared pool of seven annual Skip the Line passes from Family management."
        : wasNonMember
          ? `Your Bluebird ${label} membership is active. You can now join flight queues${bonusPasses > 0 ? ` — ${bonusPasses} Skip the Line passes added` : ""}.`
          : `Your membership has been upgraded to ${label}. ${bonusPasses} Skip the Line passes added.`,
      type: "membership",
    });

    return res.json(await membershipPayload(updated));
  } catch (err) {
    return res.status(500).json({ error: "Failed to upgrade membership" });
  }
});

// POST /membership/buy-pass
// Demo-only checkout: adds one Skip the Line pass ($2,000, never billed).
// Gated exactly like the demo upgrade above.
router.post("/buy-pass", authMiddleware, async (req, res) => {
  if (process.env.DEMO_MODE !== "true" && process.env.NODE_ENV !== "development") {
    return res.status(501).json({
      error: "Pass purchases require a payment provider integration in production. Set DEMO_MODE=true to enable the demo checkout.",
    });
  }
  const userId = (req as any).userId;
  try {
    // Pass purchases are a member feature — non-members must join first.
    const [buyer] = await db
      .select({ membershipTier: usersTable.membershipTier })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!buyer) return res.status(404).json({ error: "User not found" });
    if (buyer.membershipTier === "none") {
      return res.status(403).json({
        error: "A Bluebird membership is required to buy Skip the Line passes. Choose a plan to join.",
        code: "MEMBERSHIP_REQUIRED",
      });
    }

    const [updated] = await db
      .update(usersTable)
      .set({ linePassCount: sql`${usersTable.linePassCount} + 1` })
      .where(eq(usersTable.id, userId))
      .returning({ linePassCount: usersTable.linePassCount });
    if (!updated) return res.status(404).json({ error: "User not found" });

    await db.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: "Skip the Line pass purchased ⚡",
      body: "1 Skip the Line pass has been added to your account ($2,000 demo checkout — no real charge).",
      type: "membership",
    });

    return res.json({ linePassCount: updated.linePassCount });
  } catch (err) {
    return res.status(500).json({ error: "Failed to purchase pass" });
  }
});

// POST /membership/change
// Schedules a downgrade or cancellation effective at the next renewal date,
// or reverts a pending change. Mirrors the demo-only upgrade endpoint.
router.post("/change", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const { action, tier } = req.body ?? {};

  if (!["downgrade", "cancel", "revert"].includes(action)) {
    return res.status(400).json({ error: "Invalid action. Choose 'downgrade', 'cancel', or 'revert'" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    const effective = renewalDate();
    let pendingTier: string | null;
    let title: string;
    let body: string;

    if (action === "downgrade") {
      if (!tier || !["base", "plus"].includes(tier)) {
        return res.status(400).json({ error: "Invalid tier. Choose 'base' or 'plus'" });
      }
      if (TIER_ORDER[tier] >= TIER_ORDER[user.membershipTier]) {
        return res.status(400).json({ error: "You can only downgrade to a lower tier than your current plan" });
      }
      pendingTier = tier;
      const label = tier.charAt(0).toUpperCase() + tier.slice(1);
      title = `Downgrade scheduled`;
      body = `Your membership will change to ${label} on ${effective}. You keep your current benefits until then.`;
    } else if (action === "cancel") {
      pendingTier = "cancelled";
      title = `Cancellation scheduled`;
      body = `Your membership will end on ${effective}. You keep your benefits until then.`;
    } else {
      if (!user.pendingTier) {
        return res.status(400).json({ error: "No pending plan change to revert" });
      }
      pendingTier = null;
      title = `Plan change reverted`;
      body = `Your ${PLAN_LABELS[user.membershipTier] ?? user.membershipTier} membership will continue as usual.`;
    }

    const [updated] = await db
      .update(usersTable)
      .set({ pendingTier })
      .where(eq(usersTable.id, userId))
      .returning();

    const familyPlan = await db
      .select({ id: familyPlansTable.id })
      .from(familyPlansTable)
      .where(eq(familyPlansTable.primaryUserId, userId));
    if (familyPlan[0]) {
      if (action === "revert") {
        await db.update(familyPlansTable)
          .set({ status: "active", endingTier: null })
          .where(eq(familyPlansTable.id, familyPlan[0].id));
      } else {
        await db.update(familyPlansTable)
          .set({ status: "ending", endingTier: action === "downgrade" ? pendingTier : null })
          .where(eq(familyPlansTable.id, familyPlan[0].id));
      }
    }

    await db.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title,
      body,
      type: "membership",
    });

    return res.json(await membershipPayload(updated));
  } catch (err) {
    return res.status(500).json({ error: "Failed to update membership" });
  }
});

async function familyOwner(userId: string) {
  const [access] = await db
    .select({ plan: familyPlansTable, member: familyMembersTable })
    .from(familyPlansTable)
    .innerJoin(familyMembersTable, eq(familyMembersTable.familyPlanId, familyPlansTable.id))
    .where(and(
      eq(familyPlansTable.primaryUserId, userId),
      eq(familyMembersTable.userId, userId),
      eq(familyMembersTable.role, "primary"),
      inArray(familyPlansTable.status, ["active", "ending"]),
    ));
  return access ?? null;
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

// GET /membership/family — owners see the whole household; linked members see
// only their own relationship and pass allocation.
router.get("/family", authMiddleware, async (req, res) => {
  await syncFamilyPlans();
  const family = await familySummaryForUser((req as any).userId);
  if (!family) return res.status(404).json({ error: "You are not linked to a Family/Corporate plan", code: "FAMILY_NOT_FOUND" });
  return res.json(family);
});

// POST /membership/family/invitations — send an invite, or link an existing
// account when linkExisting is true. Conflict accounts are recorded as
// conflict rows for staff review and are never auto-linked.
router.post("/family/invitations", authMiddleware, async (req, res) => {
  const ownerId = (req as any).userId;
  const email = normalizedEmail(req.body?.email);
  const linkExisting = req.body?.linkExisting === true;
  if (!email) return res.status(400).json({ error: "Enter a valid email address" });
  const owner = await familyOwner(ownerId);
  if (!owner) return res.status(403).json({ error: "Only the primary Family/Corporate holder can manage members", code: "FAMILY_OWNER_REQUIRED" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });
    const members = await txDb.select().from(familyMembersTable)
      .where(and(
        eq(familyMembersTable.familyPlanId, owner.plan.id),
        inArray(familyMembersTable.status, ["active", "pending", "conflict"]),
      ));
    if (members.length >= FAMILY_MEMBER_LIMIT) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This Family/Corporate plan already has four people", code: "FAMILY_CAPACITY_REACHED" });
    }
    if (members.some((member) => member.email === email)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "That email already has a Family invitation", code: "FAMILY_INVITATION_EXISTS" });
    }
    const [existing] = await txDb.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${email}`);
    if (existing?.id === ownerId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "The primary holder is already on this plan" });
    }
    if (existing && existing.membershipTier !== "none") {
      const memberId = makeId();
      await txDb.insert(familyMembersTable).values({
        id: memberId,
        familyPlanId: owner.plan.id,
        userId: existing.id,
        email,
        role: "member",
        status: "conflict",
        previousMembershipTier: existing.membershipTier,
      });
      await client.query("COMMIT");
      return res.status(409).json({
        error: "This account has an existing membership and needs staff review before it can join the Family plan",
        code: "FAMILY_MEMBERSHIP_CONFLICT",
        memberId,
        status: "conflict",
      });
    }
    const memberId = makeId();
    const token = makeFamilyToken();
    const member = await txDb.insert(familyMembersTable).values({
      id: memberId,
      familyPlanId: owner.plan.id,
      userId: linkExisting ? existing?.id ?? null : null,
      email,
      role: "member",
      status: linkExisting && existing ? "active" : "pending",
      previousMembershipTier: linkExisting && existing ? existing.membershipTier : null,
      joinedAt: linkExisting && existing ? new Date() : null,
    }).returning();
    if (linkExisting && existing) {
      await txDb.update(usersTable)
        .set({ membershipTier: "plus" })
        .where(eq(usersTable.id, existing.id));
      await client.query("COMMIT");
      return res.status(201).json({ status: "linked", family: await familySummaryForUser(ownerId, txDb) });
    }
    const invitation = await txDb.insert(familyInvitationsTable).values({
      id: makeId(),
      familyPlanId: owner.plan.id,
      familyMemberId: member[0].id,
      email,
      tokenHash: hashFamilyToken(token),
      expiresAt: new Date(Date.now() + FAMILY_INVITATION_TTL_MS),
    }).returning();
    await client.query("COMMIT");
    return res.status(201).json({
      status: "invited",
      invitation: {
        id: invitation[0].id,
        memberId,
        email,
        expiresAt: invitation[0].expiresAt,
        acceptanceToken: token,
        acceptancePath: `/join/family/${token}`,
      },
      family: await familySummaryForUser(ownerId),
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "40001" || err?.code === "23505") {
      return res.status(409).json({ error: "This Family member invitation changed — please try again", code: "FAMILY_UPDATE_CONFLICT" });
    }
    return res.status(500).json({ error: "Could not create Family invitation" });
  } finally {
    client.release();
  }
});

router.post("/family/invitations/:token/accept", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const token = String(req.params.token ?? "").trim();
  if (!token) return res.status(400).json({ error: "Invitation link is invalid" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });
    const [invitation] = await txDb.select({
      invitation: familyInvitationsTable,
      member: familyMembersTable,
      plan: familyPlansTable,
    }).from(familyInvitationsTable)
      .innerJoin(familyMembersTable, eq(familyInvitationsTable.familyMemberId, familyMembersTable.id))
      .innerJoin(familyPlansTable, eq(familyInvitationsTable.familyPlanId, familyPlansTable.id))
      .where(eq(familyInvitationsTable.tokenHash, hashFamilyToken(token)));
    if (!invitation || invitation.invitation.acceptedAt || invitation.invitation.expiresAt.getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "This Family invitation has expired or was already used", code: "FAMILY_INVITATION_EXPIRED" });
    }
    if (!["active", "ending"].includes(invitation.plan.status) || invitation.member.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This Family plan is no longer accepting members", code: "FAMILY_PLAN_INACTIVE" });
    }
    const [user] = await txDb.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "User not found" });
    }
    if ((user.email ?? "").trim().toLowerCase() !== invitation.invitation.email) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Sign in with the account that matches this invitation email", code: "FAMILY_INVITATION_EMAIL_MISMATCH" });
    }
    if (user.membershipTier !== "none") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This account already has an individual membership and needs staff review", code: "FAMILY_MEMBERSHIP_CONFLICT" });
    }
    const existingLink = await txDb.select({ id: familyMembersTable.id }).from(familyMembersTable)
      .where(and(eq(familyMembersTable.userId, userId), eq(familyMembersTable.status, "active")));
    if (existingLink.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This account is already linked to a Family plan", code: "FAMILY_ALREADY_LINKED" });
    }
    await txDb.update(familyMembersTable).set({
      userId,
      status: "active",
      previousMembershipTier: user.membershipTier,
      joinedAt: new Date(),
    }).where(and(eq(familyMembersTable.id, invitation.member.id), eq(familyMembersTable.status, "pending")));
    await txDb.update(familyInvitationsTable).set({ acceptedAt: new Date() })
      .where(eq(familyInvitationsTable.id, invitation.invitation.id));
    await txDb.update(usersTable).set({ membershipTier: "plus" }).where(eq(usersTable.id, userId));
    await client.query("COMMIT");
    return res.json({ status: "accepted", family: await familySummaryForUser(userId) });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "40001" || err?.code === "23505") {
      return res.status(409).json({ error: "This invitation was accepted elsewhere — refresh and try again", code: "FAMILY_UPDATE_CONFLICT" });
    }
    return res.status(500).json({ error: "Could not accept Family invitation" });
  } finally {
    client.release();
  }
});

router.patch("/family/members/:memberId/allocation", authMiddleware, async (req, res) => {
  const ownerId = (req as any).userId;
  const requested = Number(req.body?.allocatedPasses);
  if (!Number.isInteger(requested) || requested < 0 || requested > FAMILY_PASS_TOTAL) {
    return res.status(400).json({ error: `Allocation must be a whole number from 0 to ${FAMILY_PASS_TOTAL}` });
  }
  const owner = await familyOwner(ownerId);
  if (!owner) return res.status(403).json({ error: "Only the primary Family/Corporate holder can manage passes", code: "FAMILY_OWNER_REQUIRED" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });
    const [target] = await txDb.select().from(familyMembersTable)
      .where(and(eq(familyMembersTable.id, String(req.params.memberId)), eq(familyMembersTable.familyPlanId, owner.plan.id), eq(familyMembersTable.status, "active")));
    const [primary] = await txDb.select().from(familyMembersTable)
      .where(and(eq(familyMembersTable.familyPlanId, owner.plan.id), eq(familyMembersTable.role, "primary"), eq(familyMembersTable.status, "active")));
    if (!target || !primary) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Family member not found" });
    }
    if (target.role === "primary") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Use linked members to move allocations; the primary holds the shared remainder" });
    }
    if (requested < target.usedPasses) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Unused passes only can be reallocated" });
    }
    const delta = requested - target.allocatedPasses;
    const primaryAvailable = primary.allocatedPasses - primary.usedPasses;
    if (delta > primaryAvailable) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "The shared Family pass pool does not have that many unallocated passes", code: "FAMILY_PASS_LIMIT" });
    }
    await txDb.update(familyMembersTable).set({ allocatedPasses: requested }).where(eq(familyMembersTable.id, target.id));
    await txDb.update(familyMembersTable).set({
      allocatedPasses: delta > 0 ? primary.allocatedPasses - delta : primary.allocatedPasses + Math.abs(delta),
    }).where(eq(familyMembersTable.id, primary.id));
    await client.query("COMMIT");
    return res.json(await familySummaryForUser(ownerId));
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "40001") return res.status(409).json({ error: "Family allocations changed — please try again", code: "FAMILY_UPDATE_CONFLICT" });
    return res.status(500).json({ error: "Could not update Family pass allocation" });
  } finally {
    client.release();
  }
});

export default router;
