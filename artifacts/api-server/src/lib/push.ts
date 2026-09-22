import { db } from "@workspace/db";
import { devicePushTokensTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_TOKEN = /^ExponentPushToken\[.+\]$/;

export type ExpoPushTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type PushDeliveryResult = {
  attempted: boolean;
  validTokenCount: number;
  httpStatus: number | null;
  tickets: ExpoPushTicket[] | null;
  error: string | null;
};

/**
 * Sends an Expo push to every stored Expo token for the user.
 * Invalid DeviceNotRegistered tokens are dropped. Failures do not throw.
 */
export async function deliverExpoPush(
  userId: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<PushDeliveryResult> {
  const tokens = await db.select().from(devicePushTokensTable)
    .where(eq(devicePushTokensTable.userId, userId));
  const valid = tokens.filter((row) => EXPO_PUSH_TOKEN.test(row.token));
  if (valid.length === 0) {
    return {
      attempted: false,
      validTokenCount: 0,
      httpStatus: null,
      tickets: null,
      error: tokens.length === 0
        ? "No push token registered for this account"
        : "Stored tokens are not valid Expo Push Tokens",
    };
  }

  try {
    const response = await fetch(EXPO_PUSH_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid.map((row) => ({
        to: row.token,
        title,
        body,
        data,
      }))),
    });
    const result = await response.json().catch(() => null) as {
      data?: ExpoPushTicket[];
      errors?: Array<{ message?: string }>;
    } | null;
    const tickets = Array.isArray(result?.data) ? result.data : null;

    if (response.ok && tickets) {
      const invalid = valid.filter((_row, index) =>
        tickets[index]?.details?.error === "DeviceNotRegistered",
      );
      if (invalid.length) {
        await db.delete(devicePushTokensTable)
          .where(inArray(devicePushTokensTable.id, invalid.map((row) => row.id)));
      }
      await db.update(devicePushTokensTable)
        .set({ lastUsedAt: new Date() })
        .where(inArray(devicePushTokensTable.id, valid.map((row) => row.id)));
    }

    return {
      attempted: true,
      validTokenCount: valid.length,
      httpStatus: response.status,
      tickets,
      error: response.ok
        ? null
        : result?.errors?.[0]?.message || `Expo Push API HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      attempted: true,
      validTokenCount: valid.length,
      httpStatus: null,
      tickets: null,
      error: error instanceof Error ? error.message : "Expo Push API request failed",
    };
  }
}
