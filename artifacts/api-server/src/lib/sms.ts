/**
 * SMS delivery boundary.
 *
 * Providers (checked in order):
 *  - Twilio:  set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *  - Webhook: set SMS_WEBHOOK_URL — POSTs { to, body } as JSON (also useful
 *             as a test harness for the provider boundary)
 *  - none:    no provider configured
 *
 * In production a configured provider is REQUIRED; without one the caller
 * must fail the request rather than pretend a message was sent. Outside
 * production, delivery may be simulated (code logged/returned in-band).
 */

export type SmsProvider = "twilio" | "webhook" | "none";

export function activeSmsProvider(): SmsProvider {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    return "twilio";
  }
  if (process.env.SMS_WEBHOOK_URL) return "webhook";
  return "none";
}

/** Sends an SMS through the configured provider. Throws on failure. */
export async function sendSms(to: string, body: string): Promise<void> {
  const provider = activeSmsProvider();
  if (provider === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN!}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: body }),
    });
    if (!res.ok) {
      throw new Error(`Twilio send failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return;
  }
  if (provider === "webhook") {
    const res = await fetch(process.env.SMS_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, body }),
    });
    if (!res.ok) throw new Error(`SMS webhook send failed: ${res.status}`);
    return;
  }
  throw new Error("No SMS provider configured");
}
