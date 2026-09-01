import { db, pool } from "@workspace/db";
import {
  queueEntriesTable,
  flightsTable,
  usersTable,
  notificationsTable,
  tripsTable,
} from "@workspace/db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { logger } from "./logger";
import { completeDepartedFlights, flightAcceptsQueueActions } from "./departure";

/**
 * Demo queue simulation.
 *
 * Periodically advances every flight queue so the app is genuinely playable:
 *  - Simulated members ahead of real users confirm (taking a seat) or drop out,
 *    so a real user who joins at #3 reaches #1 within a couple of minutes.
 *  - When a real member reaches the front with a seat available, the system's
 *    decision moment fires: the seat is confirmed automatically in one
 *    transaction (status change, renumbering, trip creation, notification).
 *    There is no manual confirm step and no acceptance window — a member's
 *    spot never expires.
 *  - Occasionally a "cancellation" frees a seat on a full flight, so browsing
 *    feels alive and queues keep moving.
 *
 * All numbers below are demo pacing knobs, not product policy.
 */
const TICK_MS = 20_000; // how often the simulation advances
const SIM_ACT_PROBABILITY = 0.6; // chance the front sim member acts each tick
const SIM_CONFIRM_PROBABILITY = 0.75; // when acting w/ seats left: confirm vs leave
const FREE_SEAT_PROBABILITY = 0.2; // chance per tick a full flight frees a seat
// Minimum time a real member waits in the queue before auto-confirmation, so
// they actually experience the waiting state after joining. Applies only to
// regular joins — Skip-the-Line passes confirm instantly at join time and
// never pass through this path. The mobile queue-status screen's "Decision
// in" countdown mirrors this value; keep them in sync.
export const REAL_MEMBER_MIN_WAIT_MS = 60_000;
const PET_CLEANING_FEE_USD = 500;

export const SIM_USER_PREFIX = "sim-user-";

const SIM_MEMBERS = [
  { id: `${SIM_USER_PREFIX}1`, name: "Ava Sterling" },
  { id: `${SIM_USER_PREFIX}2`, name: "Marcus Chen" },
  { id: `${SIM_USER_PREFIX}3`, name: "Isabella Rossi" },
  { id: `${SIM_USER_PREFIX}4`, name: "James Whitfield" },
  { id: `${SIM_USER_PREFIX}5`, name: "Sofia Andersson" },
  { id: `${SIM_USER_PREFIX}6`, name: "Ethan Brooks" },
];

export function isSimUserId(userId: string): boolean {
  return userId.startsWith(SIM_USER_PREFIX);
}

/** Creates the pool of simulated members (idempotent). */
export async function ensureSimUsers(): Promise<void> {
  const fixtures = SIM_MEMBERS.map((m, i) => ({
        id: m.id,
        name: m.name,
        // Sim users can never sign in: their reserved placeholder phone
        // numbers are non-dialable and no SMS code is ever issued for them.
        phone: `+1000000${String(i + 1).padStart(4, "0")}`,
        email: `${m.id}@bluebird-demo.local`,
        referralCode: `SIM${i + 1}DEMO`,
      }));
  await db.insert(usersTable).values(fixtures).onConflictDoNothing();
  for (const fixture of fixtures) {
    await db.update(usersTable).set({
      name: fixture.name,
      phone: fixture.phone,
      email: fixture.email,
      referralCode: fixture.referralCode,
    }).where(eq(usersTable.id, fixture.id));
  }
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startQueueSimulation(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => logger.error({ err }, "Queue simulation tick failed"));
  }, TICK_MS);
  // unref so the timer never keeps a dying process alive
  (timer as any).unref?.();
  logger.info({ tickMs: TICK_MS }, "Queue simulation started");
}

async function tick(): Promise<void> {
  // Move past-departure flights (and their upcoming trips) to completed so
  // Discover and Trips stay fresh even without read traffic.
  await completeDepartedFlights().catch((err) =>
    logger.error({ err }, "Departure sweep failed on simulation tick"),
  );

  // Snapshot all waiting entries grouped by flight (ordered by position).
  const waiting = await db
    .select()
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "waiting"))
    .orderBy(asc(queueEntriesTable.position));

  const byFlight = new Map<string, typeof waiting>();
  for (const entry of waiting) {
    const list = byFlight.get(entry.flightId) ?? [];
    list.push(entry);
    byFlight.set(entry.flightId, list);
  }

  for (const [flightId, entries] of byFlight) {
    try {
      await advanceFlightQueue(flightId, entries[0]);
    } catch (err: any) {
      const pgCode = err?.code ?? err?.cause?.code;
      // Serialization conflict with a real user action — skip, retry next tick.
      if (pgCode !== "40001") {
        logger.error({ err, flightId }, "Queue simulation flight step failed");
      }
    }
  }

  // Occasionally free a seat on a fully-booked flight (simulated cancellation).
  if (Math.random() < FREE_SEAT_PROBABILITY) {
    await maybeFreeSeatOnFullFlight();
  }
}

/**
 * Advances a single flight's queue by acting on its front entry, inside a
 * SERIALIZABLE transaction (same isolation as real queue mutations) so the
 * simulation can never corrupt positions while racing a real user.
 */
async function advanceFlightQueue(
  flightId: string,
  frontSnapshot: typeof queueEntriesTable.$inferSelect,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });

    // Re-read the front entry inside the transaction — the snapshot may be stale.
    const [front] = await txDb
      .select()
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.id, frontSnapshot.id),
          eq(queueEntriesTable.status, "waiting"),
          eq(queueEntriesTable.position, 1),
        ),
      );
    if (!front) {
      await client.query("ROLLBACK");
      return;
    }

    const [flight] = await txDb
      .select()
      .from(flightsTable)
      .where(eq(flightsTable.id, flightId));
    if (!flight) {
      await client.query("ROLLBACK");
      return;
    }
    // Never advance a queue on a flight that has departed or is no longer
    // available — the departure sweep will expire these waiting entries.
    if (!flightAcceptsQueueActions(flight)) {
      await client.query("ROLLBACK");
      return;
    }

    const [{ value: confirmedPax }] = await txDb
      .select({ value: sql<number>`coalesce(sum(${queueEntriesTable.passengers}), 0)` })
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.flightId, flightId),
          eq(queueEntriesTable.status, "confirmed"),
        ),
      );
    const seatsRemaining = flight.seatsAvailable - Number(confirmedPax);

    if (isSimUserId(front.userId)) {
      // ── Simulated member at the front: confirm or drop out on a cadence ──
      if (Math.random() >= SIM_ACT_PROBABILITY) {
        await client.query("ROLLBACK");
        return;
      }

      const confirms =
        seatsRemaining >= front.passengers && Math.random() < SIM_CONFIRM_PROBABILITY;

      if (confirms) {
        // Sim member takes their seat exactly like a real member: the entry
        // becomes 'confirmed' and counts toward the confirmed-passenger
        // capacity aggregate. flights.seatsAvailable is never mutated — it is
        // the capacity baseline; remaining seats are derived everywhere as
        // seatsAvailable - sum(confirmed passengers).
        await txDb
          .update(queueEntriesTable)
          .set({ status: "confirmed" })
          .where(eq(queueEntriesTable.id, front.id));
      } else {
        await txDb
          .update(queueEntriesTable)
          .set({ status: "cancelled" })
          .where(eq(queueEntriesTable.id, front.id));
      }

      await closeGap(txDb, flightId, front.position);
      await notifyNewFront(txDb, flightId, flight);
      await client.query("COMMIT");
      return;
    }

    // ── Real member at the front: the decision moment ──
    // With a seat available, the system confirms automatically in this same
    // transaction — status change, renumbering, trip creation, and the
    // flight_confirmed notification commit together. No manual confirm step,
    // no acceptance window, no expiry: a member's spot never lapses.
    //
    // Minimum-wait gate: a real member is only confirmed once they have been
    // in the queue for at least REAL_MEMBER_MIN_WAIT_MS, so a fresh join at
    // position 1 still experiences the waiting state. Until then they hold
    // their spot and are retried on later ticks.
    const waitedMs = Date.now() - new Date(front.createdAt).getTime();
    if (waitedMs < REAL_MEMBER_MIN_WAIT_MS) {
      await client.query("ROLLBACK");
      return;
    }
    if (seatsRemaining >= front.passengers) {
      const [confirmed] = await txDb
        .update(queueEntriesTable)
        .set({ status: "confirmed" })
        .where(
          and(
            eq(queueEntriesTable.id, front.id),
            eq(queueEntriesTable.status, "waiting"),
          ),
        )
        .returning();
      if (!confirmed) {
        await client.query("ROLLBACK");
        return;
      }
      await closeGap(txDb, flightId, front.position);
      await txDb.insert(tripsTable).values({
        id: makeId(),
        userId: front.userId,
        flightId,
        status: "upcoming",
        cleaningFeeUsd: front.bringingPet ? PET_CLEANING_FEE_USD : 0,
      });
      await txDb.insert(notificationsTable).values({
        id: makeId(),
        userId: front.userId,
        title: "Flight confirmed! ✈️",
        body: `Your seat on ${flight.fromCity} → ${flight.toCity} is confirmed — no action needed.${front.bringingPet ? ` The $${PET_CLEANING_FEE_USD} pet cleaning fee now applies.` : " See you on board."}`,
        type: "flight_confirmed",
      });
      await notifyNewFront(txDb, flightId, flight);
      await client.query("COMMIT");
      return;
    }

    // No seat available yet — hold position and re-check next tick.
    await client.query("ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

type TxDb = NodePgDatabase<typeof schema>;

/**
 * Keeps waiting positions contiguous after the front entry leaves, appending
 * a 'moved' event to each renumbered row's movement_history in the same bulk
 * UPDATE so the log can never drift from the actual position.
 */
async function closeGap(txDb: TxDb, flightId: string, removedPosition: number) {
  await txDb
    .update(queueEntriesTable)
    .set({
      position: sql`${queueEntriesTable.position} - 1`,
      movementHistory: sql`coalesce(${queueEntriesTable.movementHistory}, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('type', 'moved', 'from', ${queueEntriesTable.position}, 'to', ${queueEntriesTable.position} - 1, 'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
    })
    .where(
      and(
        eq(queueEntriesTable.flightId, flightId),
        eq(queueEntriesTable.status, "waiting"),
        sql`${queueEntriesTable.position} > ${removedPosition}`,
      ),
    );
}

/**
 * After the queue advances, tell the new front-of-line member (if real) their
 * position improved. The acceptance-window notification itself fires on the
 * auto-confirmation itself happens on the next tick, so this is a lightweight
 * "you moved up" ping.
 */
async function notifyNewFront(
  txDb: TxDb,
  flightId: string,
  flight: typeof flightsTable.$inferSelect,
) {
  const [newFront] = await txDb
    .select()
    .from(queueEntriesTable)
    .where(
      and(
        eq(queueEntriesTable.flightId, flightId),
        eq(queueEntriesTable.status, "waiting"),
        eq(queueEntriesTable.position, 1),
      ),
    );
  if (newFront && !isSimUserId(newFront.userId)) {
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId: newFront.userId,
      title: "You're next in line",
      body: `The queue moved — you're now #1 for ${flight.fromCity} → ${flight.toCity}. Your seat will be confirmed automatically at the decision moment.`,
      type: "queue_update",
    });
  }
}

/**
 * Called inside the same transaction as a real member's booking cancellation,
 * right after the confirmed queue entry flips to 'cancelled'. Makes the queue
 * feel instantly responsive instead of waiting for the next simulation tick:
 *  - If the front waiting member is real, eligible (enough freed seats for
 *    their party) and has passed the minimum-wait gate, they are confirmed
 *    immediately — status flip, renumbering, trip creation, and notification
 *    all commit atomically with the cancellation itself.
 *  - Otherwise, a real front member gets the "a seat just opened up" ping so
 *    they know their confirmation is imminent.
 * Sim members at the front are left to the regular simulation cadence.
 */
export async function promoteFrontAfterSeatFreed(
  txDb: TxDb,
  flightId: string,
): Promise<void> {
  const [front] = await txDb
    .select()
    .from(queueEntriesTable)
    .where(
      and(
        eq(queueEntriesTable.flightId, flightId),
        eq(queueEntriesTable.status, "waiting"),
        eq(queueEntriesTable.position, 1),
      ),
    );
  if (!front || isSimUserId(front.userId)) return;

  const [flight] = await txDb
    .select()
    .from(flightsTable)
    .where(eq(flightsTable.id, flightId));
  if (!flight) return;
  // Never promote into a flight that has departed or is no longer available.
  if (!flightAcceptsQueueActions(flight)) return;

  const [{ value: confirmedPax }] = await txDb
    .select({ value: sql<number>`coalesce(sum(${queueEntriesTable.passengers}), 0)` })
    .from(queueEntriesTable)
    .where(
      and(
        eq(queueEntriesTable.flightId, flightId),
        eq(queueEntriesTable.status, "confirmed"),
      ),
    );
  const seatsRemaining = flight.seatsAvailable - Number(confirmedPax);

  const waitedMs = Date.now() - new Date(front.createdAt).getTime();
  const eligible =
    seatsRemaining >= front.passengers && waitedMs >= REAL_MEMBER_MIN_WAIT_MS;

  if (!eligible) {
    // Not confirmable yet (seat too small for their party or still inside the
    // minimum-wait window) — at least tell them a seat opened.
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId: front.userId,
      title: "A seat just opened up",
      body: `A member cancelled on ${flight.fromCity} → ${flight.toCity} — a seat is now available and yours will be confirmed automatically.`,
      type: "queue_update",
    });
    return;
  }

  const [confirmed] = await txDb
    .update(queueEntriesTable)
    .set({ status: "confirmed" })
    .where(
      and(
        eq(queueEntriesTable.id, front.id),
        eq(queueEntriesTable.status, "waiting"),
      ),
    )
    .returning();
  if (!confirmed) return;

  await closeGap(txDb, flightId, front.position);
  await txDb.insert(tripsTable).values({
    id: makeId(),
    userId: front.userId,
    flightId,
    status: "upcoming",
    cleaningFeeUsd: front.bringingPet ? PET_CLEANING_FEE_USD : 0,
  });
  await txDb.insert(notificationsTable).values({
    id: makeId(),
    userId: front.userId,
    title: "Flight confirmed! ✈️",
    body: `Your seat on ${flight.fromCity} → ${flight.toCity} is confirmed — no action needed.${front.bringingPet ? ` The $${PET_CLEANING_FEE_USD} pet cleaning fee now applies.` : " See you on board."}`,
    type: "flight_confirmed",
  });
  await notifyNewFront(txDb, flightId, flight);
}

/**
 * Simulated cancellation: on a fully-booked flight (no remaining derived
 * seats), a simulated member who already confirmed occasionally cancels their
 * booking, freeing capacity for whoever is waiting.
 */
async function maybeFreeSeatOnFullFlight(): Promise<void> {
  // Flights where confirmed passengers have consumed all baseline seats AND
  // at least one confirmed entry belongs to a simulated member we can cancel.
  const candidates = await db
    .select({
      flightId: queueEntriesTable.flightId,
      entryId: sql<string>`(array_agg(${queueEntriesTable.id}) FILTER (WHERE ${queueEntriesTable.userId} LIKE ${SIM_USER_PREFIX + "%"}))[1]`,
      confirmedPax: sql<number>`sum(${queueEntriesTable.passengers})`,
    })
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "confirmed"))
    .groupBy(queueEntriesTable.flightId);

  const flights = await db
    .select()
    .from(flightsTable)
    .where(eq(flightsTable.status, "available"));
  const flightById = new Map(flights.map((f) => [f.id, f]));

  const full = candidates.filter((c) => {
    const f = flightById.get(c.flightId);
    return f && c.entryId && Number(c.confirmedPax) >= f.seatsAvailable;
  });
  if (full.length === 0) return;

  const pick = full[Math.floor(Math.random() * full.length)];
  const flight = flightById.get(pick.flightId)!;
  await db
    .update(queueEntriesTable)
    .set({ status: "cancelled" })
    .where(
      and(eq(queueEntriesTable.id, pick.entryId), eq(queueEntriesTable.status, "confirmed")),
    );
  logger.info(
    { flightId: flight.id, route: `${flight.fromAirport}-${flight.toAirport}` },
    "Simulation freed a seat on a full flight (sim member cancelled)",
  );

  // Anyone waiting at the front of this flight's queue may now be able to
  // confirm — give a real user a heads-up that a seat opened.
  const [front] = await db
    .select()
    .from(queueEntriesTable)
    .where(
      and(
        eq(queueEntriesTable.flightId, flight.id),
        eq(queueEntriesTable.status, "waiting"),
        eq(queueEntriesTable.position, 1),
      ),
    );
  if (front && !isSimUserId(front.userId)) {
    await db.insert(notificationsTable).values({
      id: makeId(),
      userId: front.userId,
      title: "A seat just opened up",
      body: `A member cancelled on ${flight.fromCity} → ${flight.toCity} — a seat is now available and yours will be confirmed automatically.`,
      type: "queue_update",
    });
  }
}
