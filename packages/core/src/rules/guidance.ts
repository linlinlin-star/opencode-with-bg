export * as RulesGuidance from "./guidance"

import { basename, extname, isAbsolute, join } from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { Profile } from "@opencode-ai/schema/profile"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { ProfileSelection } from "../profile/selection"
import { SystemContext } from "../system-context/index"

/**
 * Profile-driven personal rule bundles. Parallel to `InstructionContext`
 * (which loads ambient `AGENTS.md` as the system-layer instructions under
 * `core/instructions`), `RulesGuidance` loads the user's personal-style rules
 * under a separate key `core/profile-rules`:
 *
 *   - `InstructionContext` (system layer): project/global AGENTS.md, untouched.
 *   - `RulesGuidance` (personal layer): user-selected rule files + inline text,
 *     optional. When absent, contributes nothing.
 *
 * Both render with the same `Instructions from: <path>` format and combine into
 * the system prompt as peers — rules follow AGENTS.md so personal style sits
 * right next to system instructions.
 *
 * Format constraint: only `.md` files are loaded. Non-markdown paths are
 * skipped to keep the rule surface uniform with AGENTS.md and avoid injecting
 * arbitrary file types into the system prompt.
 *
 * Safety invariant: when `profile?.rules` is absent this returns
 * `SystemContext.empty`, so the effective baseline is byte-for-byte identical
 * to the pre-Profile code path. Profile participation is strictly additive.
 *
 * Any failure (missing file, decode error) degrades to `SystemContext.empty`
 * so a misconfigured Profile can never block session initialization.
 *
 * Selection (`Profile.rules.selection`) filters loaded instruction files by
 * their basename (without extension), so users can toggle entries from
 * `Profile.rules.instructions` without removing them from config. Inline text
 * is always included when present (it has no name to filter on).
 */

const Entry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  content: Schema.String,
})
type Entry = typeof Entry.Type

const View = Schema.Struct({
  entries: Schema.Array(Entry),
  inline: Schema.String,
})
type View = typeof View.Type

const render = (view: View) =>
  [
    ...view.entries.map((entry) => `Instructions from: ${entry.path}\n${entry.content}`),
    ...(view.inline.length > 0 ? [`Inline instructions:\n${view.inline}`] : []),
  ].join("\n\n")

export interface Interface {
  readonly load: (profile?: Profile.Snapshot) => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RulesGuidance") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    return Service.of({
      load: Effect.fn("RulesGuidance.load")(function* (profile?: Profile.Snapshot) {
        return yield* Effect.gen(function* () {
          const rules = profile?.rules
          if (!rules) return SystemContext.empty
          const paths = rules.instructions ?? []
          const loaded = yield* Effect.forEach(
            paths,
            (path) =>
              Effect.gen(function* () {
                const resolved = isAbsolute(path) ? path : join(location.directory, path)
                if (!resolved.endsWith(".md")) {
                  yield* Effect.logWarning("profile rule skipped: not a markdown file", { path: resolved })
                  return undefined
                }
                const content = yield* fs.readFileStringSafe(resolved)
                if (content === undefined) {
                  yield* Effect.logWarning("profile rule skipped: file not found or unreadable", { path: resolved })
                  return undefined
                }
                return { name: basename(path, extname(path)), path: resolved, content }
              }),
            { concurrency: "unbounded" },
          )
          const entries = ProfileSelection.filter(
            loaded.filter((entry): entry is Entry => entry !== undefined),
            rules.selection,
          )
          const inline = rules.inline ?? ""
          if (entries.length === 0 && inline.length === 0) return SystemContext.empty
          const view: View = { entries, inline }
          return SystemContext.make({
            key: SystemContext.Key.make("core/profile-rules"),
            codec: Schema.toCodecJson(View),
            load: Effect.succeed(view),
            baseline: render,
            update: (_previous, current) =>
              `These profile rules replace all previously loaded profile rules.\n\n${render(current)}`,
            removed: () => "Previously loaded profile rules no longer apply.",
          })
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("profile rules failed to load, falling back to empty", { error: String(error) }).pipe(
              Effect.as(SystemContext.empty),
            ),
          ),
          Effect.catchDefect((defect) =>
            Effect.logWarning("profile rules failed to load (defect), falling back to empty", {
              defect: String(defect),
            }).pipe(Effect.as(SystemContext.empty)),
          ),
        )
      }),
    })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Location.node],
})
