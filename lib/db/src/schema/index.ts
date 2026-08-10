import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  membershipTier: text("membership_tier").notNull().default("base"),
  pendingTier: text("pending_tier"),
  emailVerified: boolean("email_verified").notNull().default(false),
  linePassCount: integer("line_pass_count").notNull().default(0),
  phone: text("phone"),
  referralCode: text("referral_code").notNull(),
  referredBy: text("referred_by"),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tripsTable = pgTable("trips", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  flightId: text("flight_id").notNull().references(() => flightsTable.id),
  status: text("status").notNull().default("upcoming"),
  bookedAt: timestamp("booked_at").notNull().defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull().default("system"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
export type Notification = typeof notificationsTable.$inferSelect;
