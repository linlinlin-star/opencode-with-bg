export * as ProfileMerge from "./merge"

import { Profile } from "@opencode-ai/schema/profile"

/**
 * Field-level overlay merge of a config-level `Profile.Info` and a
 * session-level `Profile.Snapshot`. Each top-level field (`skills`, `rules`)
 * is resolved independently: a session value wins when present, otherwise the
 * config value is inherited. When neither side sets a field it is omitted.
 *
 * Returns `undefined` when no field is set on either side, so callers observe
 * the identity behavior (no filtering applied) — identical to the pre-Profile
 * code path.
 */
export function merge(
  config?: Profile.Info,
  session?: Profile.Snapshot,
): Profile.Snapshot | undefined {
  if (!config) return session
  if (!session) return config
  const skills = session.skills ?? config.skills
  const rules = session.rules ?? config.rules
  if (skills === undefined && rules === undefined) return undefined
  return { ...(skills ? { skills } : {}), ...(rules ? { rules } : {}) }
}
