import crypto from "crypto";
import { db } from "@workspace/db";
import {
  familyPlansTable,
  familyMembersTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq, inArray, lte } from "drizzle-orm";

export const FAMILY_PASS_TOTAL = 7;
export const FAMILY_MEMBER_LIMIT = 4;
export const FAMILY_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function makeFamilyToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashFamilyToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function activeFamilyMemberForUser(userId: string, database: any = db) {
  const [row] = await database
    .select({
      member: familyMembersTable,
      plan: familyPlansTable,
    })
    .from(familyMembersTable)
    .innerJoin(familyPlansTable, eq(familyMembersTable.familyPlanId, familyPlansTable.id))
    .where(and(
      eq(familyMembersTable.userId, userId),
      inArray(familyMembersTable.status, ["active"]),
      inArray(familyPlansTable.status, ["active", "ending"]),
    ));
  return row ?? null;
}

/**
 * Applies the demo annual lifecycle lazily. Renewal starts a fresh seven-pass
 * pool; a scheduled end restores each linked account's prior tier and never
 * touches that account's personal pass balance.
 */
export async function syncFamilyPlans(): Promise<void> {
  const now = new Date();
  const endingPlans = await db
    .select()
    .from(familyPlansTable)
    .where(and(
      eq(familyPlansTable.status, "ending"),
      lte(familyPlansTable.renewalAt, now),
    ));

  for (const plan of endingPlans) {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(familyPlansTable)
        .where(eq(familyPlansTable.id, plan.id))
        .for("update");
      if (!locked || locked.status !== "ending" || locked.renewalAt > new Date()) return;
      const members = await tx
        .select()
        .from(familyMembersTable)
        .where(eq(familyMembersTable.familyPlanId, locked.id));
      for (const member of members) {
        if (!member.userId) continue;
        const restoredTier = member.role === "primary"
          ? locked.endingTier ?? member.previousMembershipTier ?? "none"
          : member.previousMembershipTier ?? "none";
        await tx
          .update(usersTable)
          .set({ membershipTier: restoredTier })
          .where(eq(usersTable.id, member.userId));
      }
      await tx
        .update(familyMembersTable)
        .set({ status: "ended" })
        .where(eq(familyMembersTable.familyPlanId, locked.id));
      await tx
        .update(familyPlansTable)
        .set({ status: "ended", endedAt: new Date() })
        .where(eq(familyPlansTable.id, locked.id));
    });
  }

  const renewingPlans = await db
    .select()
    .from(familyPlansTable)
    .where(and(
      eq(familyPlansTable.status, "active"),
      lte(familyPlansTable.renewalAt, now),
    ));

  for (const plan of renewingPlans) {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(familyPlansTable)
        .where(eq(familyPlansTable.id, plan.id))
        .for("update");
      if (!locked || locked.status !== "active" || locked.renewalAt > new Date()) return;
      const members = await tx
        .select()
        .from(familyMembersTable)
        .where(and(
          eq(familyMembersTable.familyPlanId, locked.id),
          eq(familyMembersTable.status, "active"),
        ));
      const nextRenewal = new Date(locked.renewalAt);
      nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);
      await tx
        .update(familyMembersTable)
        .set({ usedPasses: 0 })
        .where(and(
          eq(familyMembersTable.familyPlanId, locked.id),
          eq(familyMembersTable.status, "active"),
        ));
      // Allocations remain assigned, but all unused passes from the prior
      // year are gone and the new annual pool begins with the same assignments.
      if (members.length > 0) {
        const allocated = members.reduce((sum, member) => sum + member.allocatedPasses, 0);
        if (allocated < FAMILY_PASS_TOTAL) {
          const primary = members.find((member) => member.role === "primary");
          if (primary) {
            await tx
              .update(familyMembersTable)
              .set({ allocatedPasses: primary.allocatedPasses + FAMILY_PASS_TOTAL - allocated })
              .where(eq(familyMembersTable.id, primary.id));
          }
        }
      }
      await tx
        .update(familyPlansTable)
        .set({ renewalAt: nextRenewal })
        .where(eq(familyPlansTable.id, locked.id));
    });
  }
}