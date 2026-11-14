import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tstz("created_at").defaultNow().notNull();
const uuidText = (name: string) => text(name).primaryKey().default(sql`gen_random_uuid()::text`);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// ---- Better Auth tables (its Drizzle adapter maps the camelCase keys to these columns) ----

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: tstz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  /** The member's colour on the map and in the plan (chosen at sign-up). */
  colour: text("colour").notNull(),
  isDemo: boolean("is_demo").default(false).notNull(),
  lastActiveAt: tstz("last_active_at"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---- Trips ----

export const trips = pgTable("trips", {
  id: uuidText("id"),
  name: text("name").notNull(),
  /** Calendar date "YYYY-MM-DD" as a string: never a timestamp, so no timezone can shift it. */
  startDate: text("start_date").notNull(),
  days: integer("days").notNull(),
  destination: jsonb("destination"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  isDemo: boolean("is_demo").notNull().default(false),
  friendRanAt: tstz("friend_ran_at"),
  createdAt: createdAt(),
  updatedAt: tstz("updated_at").defaultNow().notNull(),
});

export const tripMembers = pgTable(
  "trip_members",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: tstz("joined_at").defaultNow().notNull(),
    /** Soft removal: a removed member keeps the row (so sync can say "removed") but has no access. */
    removedAt: tstz("removed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.userId] }),
    index("trip_members_user_id_idx").on(t.userId),
    check("trip_members_role_check", sql`${t.role} in ('owner', 'member')`),
  ],
);

/** Written when a trip is deleted, so a client can be told "deleted" rather than "removed". */
export const tripTombstones = pgTable("trip_tombstones", {
  tripId: text("trip_id").primaryKey(),
  deletedAt: tstz("deleted_at").defaultNow().notNull(),
});

export const tripInvites = pgTable(
  "trip_invites",
  {
    id: uuidText("id"),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["link", "email"] }).notNull(),
    /** SHA-256 of the link token; the token itself is never stored. */
    tokenHash: text("token_hash").unique(),
    /** Lowercased invitee address for email invites. */
    email: text("email"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [
    index("trip_invites_trip_id_idx").on(t.tripId),
    index("trip_invites_email_idx").on(t.email),
    check("trip_invites_kind_check", sql`${t.kind} in ('link', 'email')`),
    check("trip_invites_email_lower_check", sql`${t.email} is null or ${t.email} = lower(${t.email})`),
  ],
);

export const tripDocuments = pgTable("trip_documents", {
  tripId: text("trip_id")
    .primaryKey()
    .references(() => trips.id, { onDelete: "cascade" }),
  /** The Yjs document state (binary update). */
  state: bytea("state").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  updatedAt: tstz("updated_at").defaultNow().notNull(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: tstz("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
