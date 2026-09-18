const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export type FamilyInvitationEmailInput = {
  recipient: string;
  acceptanceToken: string;
  expiresAt: Date;
};

export class FamilyInvitationEmailError extends Error {
  readonly code: "configuration" | "provider";

  constructor(code: "configuration" | "provider", message: string) {
    super(message);
    this.name = "FamilyInvitationEmailError";
    this.code = code;
  }
}

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new FamilyInvitationEmailError(
      "configuration",
      `Invitation email delivery is not configured (${name} is missing)`,
    );
  }
  return value;
}

function publicAppUrl(): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  // Development previews have a stable host. Production must set an explicit
  // public URL so invitation links never point at an internal or stale host.
  if (process.env.NODE_ENV !== "production" && process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  throw new FamilyInvitationEmailError(
    "configuration",
    "Invitation email delivery is not configured (PUBLIC_APP_URL is missing)",
  );
}

function invitationUrl(token: string): string {
  return `${publicAppUrl()}/join/family/${encodeURIComponent(token)}`;
}

function formatExpiry(expiresAt: Date): string {
  return expiresAt.toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
}

export async function sendFamilyInvitationEmail(
  input: FamilyInvitationEmailInput,
): Promise<{ providerMessageId: string | null }> {
  const apiKey = requiredSetting("RESEND_API_KEY");
  const from = requiredSetting("EMAIL_FROM");
  const link = invitationUrl(input.acceptanceToken);
  const expiry = formatExpiry(input.expiresAt);

  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.recipient],
      subject: "Your Bluebird Family/Corporate invitation",
      text: [
        "You have been invited to join a Bluebird Family/Corporate plan.",
        "",
        `Accept your invitation: ${link}`,
        "",
        `This single-use invitation expires ${expiry}.`,
        "Sign in with the invited email address before accepting.",
      ].join("\n"),
      html: [
        "<p>You have been invited to join a Bluebird Family/Corporate plan.</p>",
        `<p><a href="${link}">Accept your Bluebird invitation</a></p>`,
        `<p>This single-use invitation expires ${expiry}. Sign in with the invited email address before accepting.</p>`,
      ].join(""),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "The email provider could not be reached";
    throw new FamilyInvitationEmailError("provider", `Invitation email could not be sent: ${message}`);
  });

  if (!response.ok) {
    const providerMessage = await response.text().catch(() => "");
    const detail = providerMessage.replace(/\s+/g, " ").trim().slice(0, 300);
    throw new FamilyInvitationEmailError(
      "provider",
      `Invitation email could not be sent${detail ? `: ${detail}` : ""}`,
    );
  }

  const result = await response.json().catch(() => ({})) as { id?: unknown };
  return { providerMessageId: typeof result.id === "string" ? result.id : null };
}