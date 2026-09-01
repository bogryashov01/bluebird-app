import assert from "node:assert/strict";
import { createRequire } from "node:module";

const dbRequire = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const apiRequire = createRequire(new URL("../package.json", import.meta.url));
const { Pool } = dbRequire("pg");
const jwt = apiRequire("jsonwebtoken");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const base = process.env.API_BASE
  ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api` : "http://localhost:3001/api");

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userId = `concierge-callback-user-${suffix}`;
const routineId = `concierge-routine-${suffix}`;
const escalatedId = `concierge-escalated-${suffix}`;
const token = jwt.sign({ userId }, process.env.JWT_SECRET ?? "bluebird-dev-only-secret", { expiresIn: "30d" });

async function post(body, authorized = true) {
  const response = await fetch(`${base}/concierge/callback-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await pool.query(
    `INSERT INTO users (id, name, phone, referral_code) VALUES ($1, 'Callback Tester', $2, $3)`,
    [userId, `+1555${String(Date.now()).slice(-7)}`, `CB${suffix.slice(-8)}`],
  );
  await pool.query(
    `INSERT INTO concierge_messages (id, user_id, role, content, requires_human_follow_up, created_at)
     VALUES ($1, $3, 'assistant', 'Routine answer', false, NOW()),
            ($2, $3, 'assistant', 'A team member will contact you.', true, NOW() + INTERVAL '1 millisecond')`,
    [routineId, escalatedId, userId],
  );
  const newerValues = [];
  const newerParams = [];
  for (let index = 0; index < 110; index++) {
    const offset = index * 4;
    newerValues.push(`($${offset + 1}, $${offset + 2}, 'assistant', $${offset + 3}, false, NOW() + ($${offset + 4} || ' milliseconds')::INTERVAL)`);
    newerParams.push(`concierge-newer-${suffix}-${index}`, userId, `Newer message ${index}`, String(index + 2));
  }
  await pool.query(
    `INSERT INTO concierge_messages (id, user_id, role, content, requires_human_follow_up, created_at)
     VALUES ${newerValues.join(",")}`,
    newerParams,
  );

  assert.equal((await post({ assistantMessageId: escalatedId }, false)).status, 401);
  assert.equal((await post({ assistantMessageId: routineId })).status, 404);

  const first = await post({ assistantMessageId: escalatedId });
  assert.equal(first.status, 200);
  assert.equal(first.body.created, true);
  assert.equal(first.body.status, "requested");
  assert.match(first.body.message, /team member will contact/i);

  const duplicate = await post({ assistantMessageId: escalatedId });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.created, false);
  assert.equal(duplicate.body.id, first.body.id);

  const stored = await pool.query(
    `SELECT conversation_context FROM concierge_callback_requests
     WHERE user_id = $1 AND assistant_message_id = $2`,
    [userId, escalatedId],
  );
  assert.equal(stored.rowCount, 1);
  assert.ok(Array.isArray(stored.rows[0].conversation_context));
  assert.ok(stored.rows[0].conversation_context.some((message) => message.content === "A team member will contact you."));
  assert.ok(!stored.rows[0].conversation_context.some((message) => message.content.startsWith("Newer message")));
  console.log("Concierge callback authentication and idempotency checks passed.");
} finally {
  await pool.query("DELETE FROM concierge_callback_requests WHERE user_id = $1", [userId]).catch(() => {});
  await pool.query("DELETE FROM concierge_messages WHERE user_id = $1", [userId]).catch(() => {});
  await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
  await pool.end();
}