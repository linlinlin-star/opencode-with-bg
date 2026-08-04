export * as ConfigSkillPlugin from "./skill"

import { define } from "../../plugin/internal"
import path from "path"
import { Effect } from "effect"
import { Config } from "../../config"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"
import { Global } from "../../global"
import { Location } from "../../location"

export const Plugin = define({
  id: "config-skill",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    yield* ctx.skill.transform(
      Effect.fn(function* (draft) {
        const entries = yield* config.entries()
        const globalConfig = path.resolve(global.config)
        // `"deny"` restricts skill discovery to the current project's
        // `.opencode` directories: global `.opencode` skills are excluded.
        const denyGlobal = Config.latest(entries, "profile")?.skills?.mode === "deny"
        const isGlobalPath = (candidate: string) => {
          const resolved = path.resolve(candidate)
          return resolved === globalConfig || resolved.startsWith(`${globalConfig}${path.sep}`)
        }
        const skillPaths = entries.flatMap((entry) =>
          entry.type === "document"
            ? denyGlobal && entry.path !== undefined && isGlobalPath(entry.path)
              ? []
              : entry.info.skills ?? []
            : [],
        )
        for (const entry of entries) {
          if (entry.type === "document") continue
          if (denyGlobal && isGlobalPath(entry.path)) continue
          const directory = entry.path
          draft.source(
            SkillV2.DirectorySource.make({ type: "directory", path: AbsolutePath.make(path.join(directory, "skill")) }),
          )
          draft.source(
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(path.join(directory, "skills")),
            }),
          )
        }
        if (denyGlobal) {
          for (const source of draft.list()) {
            if (source.type === "embedded") draft.remove(source)
          }
        }
        for (const item of skillPaths) {
          if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) {
            draft.source(SkillV2.UrlSource.make({ type: "url", url: item }))
            continue
          }
          const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
          draft.source(
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(path.isAbsolute(expanded) ? expanded : path.join(location.directory, expanded)),
            }),
          )
        }
      }),
    )
  }),
})
