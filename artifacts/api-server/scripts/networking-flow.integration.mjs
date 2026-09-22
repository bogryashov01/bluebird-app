/**
 * Focused networking integration coverage.
 *
 * Run with the API server up: pnpm run test:networking-flow
 * The script creates and removes its own users/flight/queue entry, so queue
 * capacity and passenger/manifest rows are not changed by the test.
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
const requireApi = createRequire(new URL("../package.json", import.meta.url));
const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const pg = requireDb("pg");
const jwt = requireApi("jsonwebtoken");
const { Storage } = requireApi("@google-cloud/storage");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const BASE = process.env.API_BASE
  ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api` : "http://localhost:3001/api");
const secret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? "bluebird-dev-only-secret";
const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
const suffix = crypto.randomBytes(5).toString("hex");
const requesterId = `network-requester-${suffix}`;
const recipientId = `network-recipient-${suffix}`;
const flightId = `network-flight-${suffix}`;
const requesterToken = jwt.sign({ userId: requesterId }, secret, { expiresIn: "1h" });
const freshSessionToken = jwt.sign({ userId: requesterId }, secret, { expiresIn: "1h" });
const recipientToken = jwt.sign({ userId: recipientId }, secret, { expiresIn: "1h" });
let uploadedObject;
let failures = 0;
const check = (name, condition, details = "") => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${details}`}`);
  if (!condition) failures++;
};
async function req(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function deleteUploadedObject(uploadURL) {
  if (!uploadURL) return;
  const parsed = new URL(uploadURL);
  if (!parsed.hostname.includes("storage.googleapis.com")) return;
  const path = parsed.pathname.split("/").filter(Boolean);
  const bucketName = path.shift();
  if (!bucketName || path.length === 0) return;
  await objectStorageClient.bucket(bucketName).file(path.join("/")).delete({ ignoreNotFound: true });
}

await pool.query("BEGIN");
try {
  await pool.query(`
    INSERT INTO users (id, name, phone, membership_tier, referral_code)
    VALUES ($1, 'Network Requester', $2, 'plus', $3), ($4, 'Network Recipient', $5, 'plus', $6)
  `, [requesterId, `+1997${suffix.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")}`, `NR${suffix}`, recipientId, `+1996${suffix.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")}`, `NM${suffix}`]);
  await pool.query(`
    INSERT INTO flights (id, from_airport, from_city, to_airport, to_city, aircraft_type, aircraft_capacity,
      departure_date, departure_time, duration, seats_available, status)
    VALUES ($1, 'DFW', 'Dallas', 'ASP', 'Aspen', 'Light Jet', 6, CURRENT_DATE + 3, '10:00', '2h 15m', 5, 'available')
  `, [flightId]);
  await pool.query(`
    INSERT INTO queue_entries (id, user_id, flight_id, position, status)
    VALUES ($1, $2, $3, 1, 'waiting')
  `, [`network-entry-${suffix}`, recipientId, flightId]);
  await pool.query(`
    INSERT INTO networking_profiles (user_id, first_name, last_name, photo_url, industry, bio)
    VALUES ($1, 'Nora', 'Member', 'https://example.com/nora.jpg', 'Aviation', 'Enjoys thoughtful travel conversations.'),
           ($2, 'Rae', 'Requester', 'https://example.com/rae.jpg', 'Technology', 'Builds useful products.')
  `, [recipientId, requesterId]);
  await pool.query("COMMIT");

  const noneUser = await pool.query("INSERT INTO users (id, name, phone, membership_tier, referral_code) VALUES ($1, 'Network None', $2, 'none', $3) RETURNING id", [`network-none-${suffix}`, `+1995${suffix.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")}`, `NN${suffix}`]);
  const noneToken = jwt.sign({ userId: noneUser.rows[0].id }, secret, { expiresIn: "1h" });
  const blocked = await req("/networking/profile", { token: noneToken });
  check("non-members are rejected with MEMBERSHIP_REQUIRED", blocked.status === 403 && blocked.json?.code === "MEMBERSHIP_REQUIRED", JSON.stringify(blocked.json));

  const photoBytes = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AYf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AYf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
    "base64",
  );
  const uploadRequest = await req("/storage/uploads/request-url", {
    method: "POST",
    token: requesterToken,
    body: { name: "networking-profile.jpg", size: photoBytes.length, contentType: "image/jpeg" },
  });
  let uploaded = false;
  if (uploadRequest.status === 200 && uploadRequest.json?.uploadURL && uploadRequest.json?.objectPath) {
    uploadedObject = uploadRequest.json.uploadURL;
    const uploadResponse = await fetch(uploadRequest.json.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: photoBytes,
    });
    uploaded = uploadResponse.ok;
  }
  check("member can upload a profile photo to durable storage", uploaded, JSON.stringify(uploadRequest.json));
  const photoPath = uploadRequest.json?.objectPath;
  const savedPhoto = await req("/networking/profile", {
    method: "PATCH",
    token: requesterToken,
    body: {
      firstName: "Nora",
      lastName: "Requester",
      industry: "Aviation",
      bio: "Enjoys thoughtful travel conversations.",
      photoAssetPath: photoPath,
    },
  });
  check("stored profile photo path can be saved", uploaded && savedPhoto.status === 200 &&
    savedPhoto.json?.photoAssetPath === photoPath &&
    savedPhoto.json?.photoUrl === `/api/storage${photoPath}`);
  const freshProfile = await req("/networking/profile", { token: freshSessionToken });
  const freshPhotoUrl = freshProfile.json?.photoUrl;
  const storedPhotoResponse = freshPhotoUrl
    ? await fetch(new URL(freshPhotoUrl, BASE))
    : null;
  check("a fresh authenticated session receives the stored photo URL", freshProfile.status === 200 &&
    freshProfile.json?.photoAssetPath === photoPath &&
    typeof freshPhotoUrl === "string" &&
    freshPhotoUrl.startsWith("/api/storage/objects/uploads/") &&
    !freshPhotoUrl.startsWith("data:") &&
    storedPhotoResponse?.status === 200 &&
    storedPhotoResponse.headers.get("content-type")?.startsWith("image/jpeg"));

  const invalidType = await req("/storage/uploads/request-url", {
    method: "POST",
    token: requesterToken,
    body: { name: "profile.gif", size: 100, contentType: "image/gif" },
  });
  check("invalid profile photo types are rejected", invalidType.status === 400);
  const oversized = await req("/storage/uploads/request-url", {
    method: "POST",
    token: requesterToken,
    body: { name: "profile.jpg", size: 1_500_001, contentType: "image/jpeg" },
  });
  check("oversized profile photos are rejected", oversized.status === 400);
  const missingObject = await req("/networking/profile", {
    method: "PATCH",
    token: requesterToken,
    body: { photoAssetPath: `/objects/uploads/missing-${suffix}` },
  });
  check("missing stored profile photos are rejected", missingObject.status === 400);
  const invalidPath = await req("/networking/profile", {
    method: "PATCH",
    token: requesterToken,
    body: { photoAssetPath: `/objects/not-uploads/${suffix}` },
  });
  check("invalid stored profile photo paths are rejected", invalidPath.status === 400);

  const profile = await req("/networking/profile", { token: requesterToken });
  check("member profile reports completion", profile.status === 200 && profile.json?.completed === true);
  const front = await req(`/networking/flights/${flightId}/front-member`, { token: requesterToken });
  check("front member is resolved from position one", front.status === 200 && front.json?.member?.userId === recipientId);
  const request = await req("/networking/requests", { method: "POST", token: requesterToken, body: { flightId, message: "Hello before the flight." } });
  check("request is created without a queue mutation", request.status === 201);
  const incoming = await req("/networking/requests/incoming", { token: recipientToken });
  check("recipient sees request and message", incoming.status === 200 && incoming.json?.[0]?.message === "Hello before the flight.");
  const reported = await req(`/networking/requests/${request.json?.id}/decision`, { method: "POST", token: recipientToken, body: { action: "report", reason: "Testing report flow" } });
  check("recipient can report a request", reported.status === 200 && reported.json?.status === "reported");
  const retriedRequest = await req("/networking/requests", { method: "POST", token: requesterToken, body: { flightId, message: "Hello before the flight." } });
  check("reported requests can be safely retried", retriedRequest.status === 200 && retriedRequest.json?.id === request.json?.id);
  const accepted = await req(`/networking/requests/${request.json?.id}/decision`, { method: "POST", token: recipientToken, body: { action: "accept" } });
  check("accept creates a social connection", accepted.status === 200 && accepted.json?.status === "accepted");
  const connections = await req("/networking/connections", { token: requesterToken });
  check("accepted connection exposes full profile", connections.status === 200 && connections.json?.[0]?.member?.lastName === "Member");
  const message = await req(`/networking/connections/${accepted.json?.connection?.id}/messages`, { method: "POST", token: requesterToken, body: { content: "Nice to meet you.", clientMessageId: "networking-idempotency" } });
  const duplicate = await req(`/networking/connections/${accepted.json?.connection?.id}/messages`, { method: "POST", token: requesterToken, body: { content: "Nice to meet you.", clientMessageId: "networking-idempotency" } });
  check("duplicate message sends return the same message", message.status === 201 && duplicate.status === 200 && message.json?.id === duplicate.json?.id);
  const beforeQueue = await pool.query("SELECT position, status FROM queue_entries WHERE id = $1", [`network-entry-${suffix}`]);
  check("networking does not alter queue state", beforeQueue.rows[0]?.position === 1 && beforeQueue.rows[0]?.status === "waiting");
  const blockedConnection = await req(`/networking/connections/${accepted.json?.connection?.id}/block`, { method: "POST", token: recipientToken });
  const afterBlockMessage = await req(`/networking/connections/${accepted.json?.connection?.id}/messages`, { method: "POST", token: requesterToken, body: { content: "This should be rejected." } });
  check("blocked members cannot message each other", blockedConnection.status === 200 && afterBlockMessage.status === 403);
} finally {
  try {
    await deleteUploadedObject(uploadedObject);
  } catch (error) {
    console.error("WARN  failed to remove uploaded test photo", error);
  }
  await pool.query("DELETE FROM queue_entries WHERE flight_id = $1", [flightId]);
  await pool.query("DELETE FROM notifications WHERE user_id IN ($1, $2, $3)", [requesterId, recipientId, `network-none-${suffix}`]);
  await pool.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [requesterId, recipientId, `network-none-${suffix}`]);
  await pool.query("DELETE FROM flights WHERE id = $1", [flightId]);
  await pool.end();
}
process.exitCode = failures ? 1 : 0;