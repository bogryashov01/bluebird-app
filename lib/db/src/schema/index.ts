import { pgTable, text, boolean, integer, timestamp, jsonb, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  membershipTier: text("membership_tier").notNull().default("base"),
  pendingTier: text("pending_tier"),
  linePassCount: integer("line_pass_count").notNull().default(0),
  referralCode: text("referral_code").notNull(),
  referredBy: text("referred_by"),
  // Kept temporarily so ensureSchema can migrate installations that predate
  // multi-airport preferences. API responses never expose this legacy value.
  homeAirport: text("home_airport"),
  homeAirports: text("home_airports").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const flightsTable = pgTable("flights", {
  id: text("id").primaryKey(),
  fromAirport: text("from_airport").notNull(),
  fromCity: text("from_city").notNull(),
  toAirport: text("to_airport").notNull(),
  toCity: text("to_city").notNull(),
  aircraftType: text("aircraft_type").notNull(),
  aircraftCapacity: integer("aircraft_capacity").notNull(),
  departureDate: text("departure_date").notNull(),
  departureTime: text("departure_time").notNull(),
  duration: text("duration").notNull(),
  seatsAvailable: integer("seats_available").notNull(),
  priceUsd: integer("price_usd").notNull().default(0),
  discountPct: integer("discount_pct").notNull().default(0),
  featured: boolean("featured").notNull().default(false),
  international: boolean("international").notNull().default(false),
  internationalFeeUsd: integer("international_fee_usd").notNull().default(0),
  // Aircraft & departure enrichment for the flight details screen. Nullable
  // so pre-existing rows degrade gracefully until backfilled by the seeder.
  rangeNm: integer("range_nm"),
  cruiseSpeed: text("cruise_speed"),
  destWeather: text("dest_weather"),
  departureFbo: text("departure_fbo"),
  status: text("status").notNull().default("available"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const queueEntriesTable = pgTable("queue_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  flightId: text("flight_id").notNull().references(() => flightsTable.id),
  position: integer("position").notNull(),
  status: text("status").notNull().default("waiting"),
  usedLinePass: boolean("used_line_pass").notNull().default(false),
  passengers: integer("passengers").notNull().default(1),
  // Base members joining an international flight accept a one-time fee
  // (demo charge — recorded, never billed).
  intlFeeAccepted: boolean("intl_fee_accepted").notNull().default(false),
  bringingPet: boolean("bringing_pet").notNull().default(false),
  petFeeAcknowledged: boolean("pet_fee_acknowledged").notNull().default(false),
  // Set when this entry reaches the front of the queue and is notified that a
  // seat is ready; starts the 30-minute acceptance window.
  frontNotifiedAt: timestamp("front_notified_at"),
  // Append-only movement log: a 'joined' event at insert time plus a 'moved'
  // event for every position improvement (gap-close renumbering). Rendered on
  // the Queue Status screen as "Joined queue at #N" / "Moved #A → #B".
  movementHistory: jsonb("movement_history")
    .$type<QueueMovementEvent[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type QueueMovementEvent =
  | { type: "joined"; position: number; at: string }
  | { type: "moved"; from: number; to: number; at: string };

export const tripsTable = pgTable("trips", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  flightId: text("flight_id").notNull().references(() => flightsTable.id),
  status: text("status").notNull().default("upcoming"),
  cleaningFeeUsd: integer("cleaning_fee_usd").notNull().default(0),
  bookedAt: timestamp("booked_at").notNull().defaultNow(),
  manifestVersion: integer("manifest_version").notNull().default(0),
  manifestSubmittedAt: timestamp("manifest_submitted_at"),
  manifestDeliveryStatus: text("manifest_delivery_status"),
});

export const tripPassengersTable = pgTable("trip_passengers", {
  id: text("id").primaryKey(),
  tripId: text("trip_id").notNull().references(() => tripsTable.id, { onDelete: "cascade" }),
  passengerOrder: integer("passenger_order").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  weightKg: integer("weight_kg"),
  passportNumber: text("passport_number"),
  issuingCountry: text("issuing_country"),
  nationality: text("nationality"),
  passportExpirationDate: text("passport_expiration_date"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trip_passengers_trip_order_unique").on(table.tripId, table.passengerOrder),
  check("trip_passengers_order_positive", sql`${table.passengerOrder} > 0`),
  check("trip_passengers_weight_positive", sql`${table.weightKg} IS NULL OR ${table.weightKg} > 0`),
]);

export const manifestOperationalUpdatesTable = pgTable("manifest_operational_updates", {
  id: text("id").primaryKey(),
  tripId: text("trip_id").notNull().references(() => tripsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  deliveryStatus: text("delivery_status").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("manifest_updates_trip_version_unique").on(table.tripId, table.version),
]);

export const notificationsTable = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull().default("system"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conciergeMessagesTable = pgTable("concierge_messages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Pending SMS sign-in codes, keyed by normalized phone number. Only the
// SHA-256 hash of the 6-digit code is stored; codes expire, are single-use,
// and are capped by an attempt counter.
export const loginCodesTable = pgTable("login_codes", {
  phone: text("phone").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastSentAt: timestamp("last_sent_at").notNull().defaultNow(),
});

// Short-lived proof that an unknown phone successfully completed SMS
// verification. Only the grant hash is stored; successful registration
// consumes the row in the same transaction that creates the user.
export const registrationGrantsTable = pgTable("registration_grants", {
  grantHash: text("grant_hash").primaryKey(),
  phone: text("phone").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const revokedTokensTable = pgTable("revoked_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export const insertFlightSchema = createInsertSchema(flightsTable).omit({ id: true, createdAt: true });
export const insertQueueEntrySchema = createInsertSchema(queueEntriesTable).omit({ id: true, createdAt: true });
export const insertTripSchema = createInsertSchema(tripsTable).omit({ id: true, bookedAt: true });
export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });

export type User = typeof usersTable.$inferSelect;
export type Flight = typeof flightsTable.$inferSelect;
export type QueueEntry = typeof queueEntriesTable.$inferSelect;
export type Trip = typeof tripsTable.$inferSelect;
export type TripPassenger = typeof tripPassengersTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
export type RevokedToken = typeof revokedTokensTable.$inferSelect;
export type LoginCode = typeof loginCodesTable.$inferSelect;
export type RegistrationGrant = typeof registrationGrantsTable.$inferSelect;
export type ConciergeMessage = typeof conciergeMessagesTable.$inferSelect;
