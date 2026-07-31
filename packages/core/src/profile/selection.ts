export * as ProfileSelection from "./selection"

import { Wildcard } from "../util/wildcard"
import { Profile } from "@opencode-ai/schema/profile"

/**
 * Pure selection algebra over a `Profile.Selection`.
 *
 * Safety invariant: when `selection` is `undefined`, every predicate returns
 * the permissive result so callers observing no Profile see behavior that is
 * byte-for-byte identical to the pre-Profile code path. This is what makes
 * Profile participation opt-in without affecting existing sessions.
 *
 * Order of precedence (matches `PermissionV2.evaluate`'s last-match-wins
 * semantics, but expressed as allow-list + deny-list):
 *   1. `disable` wins over `enable` — an explicit exclude always excludes
 *   2. non-empty `enable` acts as an allow-list; anything not matched is excluded
 *   3. empty/absent `enable` permits everything not explicitly disabled
 *
 * Both lists accept wildcard patterns (`*`, `?`) matched via `Wildcard.match`,
 * consistent with `PermissionV2.evaluate` and `Permission.Ruleset` resources.
 */

/** True when `name` is permitted by `selection`. `undefined` selection = permissive. */
export function allows(name: string, selection: Profile.Selection | undefined): boolean {
  if (!selection) return true
  if (selection.disable?.some((pattern) => Wildcard.match(name, pattern))) return false
  const enable = selection.enable
  if (enable && enable.length > 0) {
    if (!enable.some((pattern) => Wildcard.match(name, pattern))) return false
  }
  return true
}

/**
 * Filters `items` by `selection`, preserving input order. `undefined` selection
 * returns a shallow copy of `items` (no filtering), so callers can treat the
 * result uniformly without a special-cased branch.
 */
export function filter<T extends { readonly name: string }>(
  items: ReadonlyArray<T>,
  selection: Profile.Selection | undefined,
): T[] {
  if (!selection) return items.slice()
  return items.filter((item) => allows(item.name, selection))
}
