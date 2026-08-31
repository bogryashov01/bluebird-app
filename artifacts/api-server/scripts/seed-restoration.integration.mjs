import pg from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const { Pool } = pg;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `seed_restore_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);

  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();

  let failures = 0;
  function check(name, condition, detail = "") {
    console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${detail}`}`);
    if (!condition) failures += 1;
  }

  try {
  const { ensureSchema, pool } = await import("@workspace/db");
  const { restoreDemoData, DEMO_MEMBER_ID } = await import("../src/lib/seed.ts");

  await ensureSchema();
  await restoreDemoData();

  const counts = async () => {
    const { rows: [row] } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM flights WHERE id LIKE 'demo-flight-%') AS flights,
        (SELECT count(*)::int FROM flights WHERE id LIKE 'demo-flight-%' AND international) AS international,
        (SELECT count(*)::int FROM users WHERE id LIKE 'sim-user-%') AS sims,
        (SELECT count(*)::int FROM queue_entries WHERE id LIKE 'demo-simq-%') AS sim_queues,
        (SELECT count(*)::int FROM trips WHERE user_id = $1) AS trips,
        (SELECT count(*)::int FROM queue_entries WHERE user_id = $1) AS queues,
        (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND id LIKE 'demo-notif-%') AS notifications,
        (SELECT line_pass_count FROM users WHERE id = $1) AS passes
    `, [DEMO_MEMBER_ID]);
    return row;
  };

  const fresh = await counts();
  check("fresh restore includes ten upcoming flights", fresh.flights === 10, JSON.stringify(fresh));
  check("fresh restore includes international routes", fresh.international === 2, JSON.stringify(fresh));
  check("fresh restore includes simulated members and queue participants",
    fresh.sims === 6 && fresh.sim_queues === 2, JSON.stringify(fresh));
  check("fresh restore includes trips, queues, notifications, and passes",
    fresh.trips === 2 && fresh.queues === 2 && fresh.notifications === 3 && fresh.passes >= 2,
    JSON.stringify(fresh));

  await pool.query(`
    INSERT INTO users (id, name, phone, email, membership_tier, line_pass_count, referral_code)
    VALUES ('real-member-fixture', 'Real Member', '+15555550999', 'real@example.test', 'base', 7, 'REALKEEP')
  `);
  await pool.query(`DELETE FROM flights WHERE id IN ('demo-flight-ORD-DAL', 'demo-flight-MIA-NAS')`);
  await pool.query(`DELETE FROM users WHERE id = 'sim-user-6'`);
  await pool.query(`DELETE FROM queue_entries WHERE id = 'demo-simq-demo-flight-JFK-MIA-1'`);
  await pool.query(`DELETE FROM trips WHERE id = $1`, [`demo-trip-upcoming-${DEMO_MEMBER_ID}`]);
  await pool.query(`DELETE FROM queue_entries WHERE id = $1`, [`demo-queue-${DEMO_MEMBER_ID}`]);
  await pool.query(`DELETE FROM notifications WHERE id = $1`, [`demo-notif-queue-${DEMO_MEMBER_ID}`]);

  await restoreDemoData();
  const repaired = await counts();
  check("partial restore repairs every deleted fixture category",
    repaired.flights === 10 && repaired.international === 2 && repaired.sims === 6 && repaired.sim_queues === 2
      && repaired.trips === 2 && repaired.queues === 2 && repaired.notifications === 3,
    JSON.stringify(repaired));
  const { rows: [realMember] } = await pool.query(
    `SELECT line_pass_count FROM users WHERE id = 'real-member-fixture'`,
  );
  check("partial restore preserves real member data", realMember?.line_pass_count === 7);

  await restoreDemoData();
  const repeated = await counts();
  check("repeated restore does not duplicate fixtures", JSON.stringify(repeated) === JSON.stringify(repaired),
    `${JSON.stringify(repaired)} -> ${JSON.stringify(repeated)}`);

  await pool.query(`UPDATE queue_entries SET status = 'confirmed' WHERE id = $1`, [`demo-queue-${DEMO_MEMBER_ID}`]);
  await pool.query(`
    INSERT INTO trips (id, user_id, flight_id, status)
    VALUES ('simulation-created-trip', $1, 'demo-flight-JFK-MIA', 'upcoming')
  `, [DEMO_MEMBER_ID]);
  await restoreDemoData();
  const { rows: [resolved] } = await pool.query(`
    SELECT
      (SELECT status FROM queue_entries WHERE id = $1) AS queue_status,
      (SELECT count(*)::int FROM trips WHERE user_id = $2 AND flight_id = 'demo-flight-JFK-MIA') AS queue_flight_trips
  `, [`demo-queue-${DEMO_MEMBER_ID}`, DEMO_MEMBER_ID]);
  check("restart preserves a simulation-resolved queue without duplicating its booking",
    resolved.queue_status === "confirmed" && resolved.queue_flight_trips === 1,
    JSON.stringify(resolved));

  await pool.end();
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }

  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});