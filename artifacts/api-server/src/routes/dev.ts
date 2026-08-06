/**
 * Dev-only test-harness routes (all disabled in production via 404).
 *
 * GET /api/dev/autologin?email=…&password=…&redirect=…
 *   Validates real credentials (bcrypt), issues a single-use opaque code
 *   (32 hex chars, 60 s TTL, stored in server memory), and redirects to
 *   the Expo dev domain at /dev-auth-tmp.html?code=CODE&redirect=DEST.
 *   The raw JWT *never* rides in a URL — only the short-lived opaque code
 *   does, and it is exchanged server-side before any token is issued to
 *   the browser.
 *
 * GET /api/dev/exchange/:code
 *   Exchanges a valid single-use code for { token, user }.  Called by the
 *   ephemeral relay page (dev-auth-tmp.html) that lives in /public only
 *   during screenshot runs and is deleted immediately afterwards.
 *
 * Both routes return 404 when NODE_ENV === "production".
 * The redirect target is validated against internal-app paths only.
 */
import { Router } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { signToken } from "../middlewares/auth";

const router = Router();

// ---------------------------------------------------------------------------
// In-memory one-time code store  { code → { tokenPayload, expiresAt } }
// ---------------------------------------------------------------------------
interface CodeEntry {
  token: string;
  userJson: string;
  expiresAt: number;
}
const pendingCodes = new Map<string, CodeEntry>();

function issuePendingCode(token: string, userJson: string): string {
  const code = randomBytes(16).toString("hex"); // 32-char opaque hex string
  pendingCodes.set(code, { token, userJson, expiresAt: Date.now() + 60_000 });
  // Evict stale entries lazily
  for (const [k, v] of pendingCodes) {
    if (v.expiresAt < Date.now()) pendingCodes.delete(k);
  }
  return code;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Only allow redirects to internal Expo-app paths. */
function validateRedirect(raw: string | undefined): string {
  const DEFAULT = "/";
  if (!raw) return DEFAULT;
  if (!/^\/(?!\/)[A-Za-z0-9\-_./()\[\]@!$&'*+,;=%?#~]*$/.test(raw)) {
    return DEFAULT;
  }
  if (raw.includes("..")) return DEFAULT;
  return raw;
}

const IS_PROD = () => process.env["NODE_ENV"] === "production";

// ---------------------------------------------------------------------------
// GET /api/dev/autologin
// ---------------------------------------------------------------------------
router.get("/dev/autologin", async (req, res) => {
  if (IS_PROD()) return res.status(404).json({ error: "Not found" });

  const { email, password, redirect } = req.query as Record<string, string>;
  if (!email || !password) {
    return res.status(400).send("Required query params: email, password");
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (!user) return res.status(401).send("User not found");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).send("Invalid password");

    const token = signToken(user.id);
    const userJson = JSON.stringify({
      id: user.id,
      name: user.name,
      email: user.email,
      membershipTier: user.membershipTier,
      emailVerified: user.emailVerified,
      linePassCount: user.linePassCount,
      referralCode: user.referralCode ?? "",
      createdAt: user.createdAt,
    });

    const dest = validateRedirect(redirect);
    const code = issuePendingCode(token, userJson);

    // Redirect to the ephemeral relay page on the Expo dev domain.
    // Only the opaque code rides in the URL — never the raw JWT.
    const expoDomain = process.env["REPLIT_EXPO_DEV_DOMAIN"];
    if (!expoDomain) {
      // Fallback: serve inline HTML for same-origin (non-Expo-domain) use
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
          `<script>` +
          `localStorage.setItem('bluebird_token',${JSON.stringify(token)});` +
          `localStorage.setItem('bluebird_user',${JSON.stringify(userJson)});` +
          `window.location.replace(${JSON.stringify(dest)});` +
          `</script></body></html>`,
      );
    }

    const relayUrl =
      `https://${expoDomain}/dev-auth-tmp.html` +
      `?code=${encodeURIComponent(code)}` +
      `&redirect=${encodeURIComponent(dest)}`;

    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, relayUrl);
  } catch {
    return res.status(500).send("Auth error");
  }
});

// ---------------------------------------------------------------------------
// GET /api/dev/exchange/:code
// ---------------------------------------------------------------------------
router.get("/dev/exchange/:code", (req, res) => {
  if (IS_PROD()) return res.status(404).json({ error: "Not found" });

  const entry = pendingCodes.get(req.params.code);
  if (!entry || entry.expiresAt < Date.now()) {
    pendingCodes.delete(req.params.code);
    return res.status(410).json({ error: "Code expired or invalid" });
  }

  // Single-use: delete immediately
  pendingCodes.delete(req.params.code);

  res.setHeader("Cache-Control", "no-store");
  return res.json({ token: entry.token, user: entry.userJson });
});

export default router;
