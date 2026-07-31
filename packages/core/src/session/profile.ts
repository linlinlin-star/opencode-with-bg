export * as SessionProfile from "./profile"

import { eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Profile } from "@opencode-ai/schema/profile"
import { SessionProfileTable } from "./profile.sql"
import type { SessionSchema } from "./schema"

/**
 * Read and write access to the per-session Profile snapshot stored in
 * `session_profile`. A missing row (or a row that fails to decode, or any
 * database error on read) returns `undefined`, which callers treat as "no
 * session-level Profile" — the identity behavior where no filtering is applied.
 *
 * `get` degrades to `undefined` on any failure so a corrupted JSON blob or
 * transient DB error can never block session initialization. This is the same
 * defensive posture used by `InstructionContext` and `SkillGuidance`. `set`
 * and `clear` are write operations and surface failures via `Effect.orDie`.
 *
 * Field-level overlay is applied by the runner via
 * `ProfileMerge.merge(config, session)`, not here: `get` returns only the
 * session-stored snapshot, not the merged effective profile.
 */

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase

export const get = Effect.fn("SessionProfile.get")(function* (db: Database, sessionID: SessionSchema.ID) {
  return yield* Effect.gen(function* () {
    const row = yield* db
      .select({ profile: SessionProfileTable.profile })
      .from(SessionProfileTable)
      .where(eq(SessionProfileTable.session_id, sessionID))
      .get()
    if (!row) return undefined
    return Option.getOrUndefined(Schema.decodeUnknownOption(Profile.Snapshot)(row.profile))
  }).pipe(
    // Both guards are required: `Effect.catch` handles typed query/decode
    // failures while `Effect.catchDefect` covers failures `orDie`-promoted
    // elsewhere in the stack or synchronous throws from the driver. Together
    // they uphold the safety invariant that no read error blocks session init.
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.catchDefect(() => Effect.succeed(undefined)),
  )
})

export const set = Effect.fn("SessionProfile.set")(function* (
  db: Database,
  sessionID: SessionSchema.ID,
  profile: Profile.Snapshot,
) {
  yield* db
    .insert(SessionProfileTable)
    .values({ session_id: sessionID, profile })
    .onConflictDoUpdate({
      target: SessionProfileTable.session_id,
      set: { profile },
    })
    .run()
    .pipe(Effect.orDie)
})

export const clear = Effect.fn("SessionProfile.clear")(function* (db: Database, sessionID: SessionSchema.ID) {
  yield* db
    .delete(SessionProfileTable)
    .where(eq(SessionProfileTable.session_id, sessionID))
    .run()
    .pipe(Effect.orDie)
})
