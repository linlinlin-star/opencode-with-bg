export * as Profile from "./profile"

import { Schema } from "effect"
import { optional } from "./schema"
import { Skill } from "./skill"

/**
 * Selectable Skills & Rules profile.
 *
 * A Profile expresses per-scope (global / project / session) selection over
 * the Skill sources and Rule bundles that the runtime observes. An empty
 * Profile is the identity: it adds nothing and removes nothing, so the
 * effective System Context baseline is unchanged. This is the safety
 * invariant that lets Profile participation be opt-in without affecting
 * existing sessions.
 *
 * Selection semantics:
 *   - `undefined` selection  → all candidates permitted (current behavior)
 *   - `enable` non-empty     → only matched candidates permitted (allow-list)
 *   - `disable`              → matched candidates excluded (deny-list)
 *   - `enable` ∩ `disable`   → `disable` wins
 *
 * Both lists accept wildcard patterns (`*`, `?`) matched via `Wildcard.match`.
 */

export interface Selection extends Schema.Schema.Type<typeof Selection> {}
export const Selection = Schema.Struct({
  enable: Schema.Array(Schema.String).pipe(optional),
  disable: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Profile.Selection" })

export interface Skills extends Schema.Schema.Type<typeof Skills> {}
export const Skills = Schema.Struct({
  // Additional Skill sources (concatenated with global/project sources).
  sources: Schema.Array(Skill.Source).pipe(optional),
  selection: Selection.pipe(optional),
}).annotate({ identifier: "Profile.Skills" })

export interface Rules extends Schema.Schema.Type<typeof Rules> {}
export const Rules = Schema.Struct({
  // Additional instruction files (paths) or remote URLs, concatenated with
  // `config.instructions` and AGENTS.md discovery.
  instructions: Schema.Array(Schema.String).pipe(optional),
  // Inline rule text for this scope. Session-level inline rules are not
  // persisted as files; they ride on `session_profile.profile`.
  inline: Schema.String.pipe(optional),
  selection: Selection.pipe(optional),
}).annotate({ identifier: "Profile.Rules" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  skills: Skills.pipe(optional),
  rules: Rules.pipe(optional),
}).annotate({ identifier: "Profile.Info" })

/**
 * Lightweight view persisted in `session_profile.profile`. Identical to
 * `Profile.Info` today; kept as a distinct name so session persistence can
 * evolve independently of the declarative config shape.
 */
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Info.pipe(Schema.annotate({ identifier: "Profile.Snapshot" }))
