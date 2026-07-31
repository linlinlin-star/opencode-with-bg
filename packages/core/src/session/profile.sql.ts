import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Profile } from "@opencode-ai/schema/profile"
import { Timestamps } from "../database/schema.sql"
import type { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

/**
 * Per-session Profile selection, persisted separately from `SessionTable` so
 * the existing session read/write path is untouched. A missing row means
 * "no session-level Profile" → the effective Profile inherits from project +
 * global config, which is the identity behavior (no filtering applied).
 *
 * `profile` stores a `Profile.Snapshot` (same shape as declarative
 * `Profile.Info`). One row per session; updates replace the row.
 */
export const SessionProfileTable = sqliteTable(
  "session_profile",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    profile: text({ mode: "json" }).notNull().$type<Profile.Snapshot>(),
    ...Timestamps,
  },
)
