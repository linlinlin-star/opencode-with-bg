import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"

export class Info extends Schema.Class<Info>("UserRule.Info")({
  id: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  content: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export const Create = Schema.Struct({
  name: Schema.String,
  content: Schema.String,
})
export type Create = Schema.Schema.Type<typeof Create>

export const Update = Schema.Struct({
  name: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
})
export type Update = Schema.Schema.Type<typeof Update>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("UserRule.NotFound", {
  id: Schema.String,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly create: (input: Create) => Effect.Effect<Info>
  readonly update: (id: string, input: Update) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: string) => Effect.Effect<void, NotFoundError>
  readonly enabledContents: () => Effect.Effect<{ name: string; content: string }[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UserRule") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const file = () => path.join(global.config, "user-rules.json")

    const load = Effect.fn("UserRule.load")(function* () {
      const data = yield* fs.readJson(file()).pipe(Effect.orElseSucceed(() => [] as unknown))
      const rules = yield* Schema.decodeUnknownEffect(Schema.Array(Info))(data).pipe(
        Effect.orElseSucceed(() => [] as Info[]),
      )
      return Array.from(rules)
    })

    const save = Effect.fn("UserRule.save")(function* (rules: Info[]) {
      yield* fs.writeJson(file(), rules).pipe(Effect.orDie)
    })

    const list = Effect.fn("UserRule.list")(function* () {
      const rules = yield* load()
      return rules.toSorted((a, b) => a.createdAt - b.createdAt)
    })

    const create = Effect.fn("UserRule.create")(function* (input: Create) {
      const now = Date.now()
      const rule = new Info({
        id: crypto.randomUUID(),
        name: input.name,
        enabled: true,
        content: input.content,
        createdAt: now,
        updatedAt: now,
      })
      const rules = yield* load()
      rules.push(rule)
      yield* save(rules)
      return rule
    })

    const update = Effect.fn("UserRule.update")(function* (id: string, input: Update) {
      const rules = yield* load()
      const rule = rules.find((item) => item.id === id)
      if (!rule) return yield* new NotFoundError({ id })
      const next = new Info({
        ...rule,
        name: input.name ?? rule.name,
        content: input.content ?? rule.content,
        enabled: input.enabled ?? rule.enabled,
        updatedAt: Date.now(),
      })
      yield* save(rules.map((item) => (item.id === id ? next : item)))
      return next
    })

    const remove = Effect.fn("UserRule.remove")(function* (id: string) {
      const rules = yield* load()
      const next = rules.filter((item) => item.id !== id)
      if (next.length === rules.length) return yield* new NotFoundError({ id })
      yield* save(next)
    })

    const enabledContents = Effect.fn("UserRule.enabledContents")(function* () {
      const rules = yield* load()
      return rules
        .filter((rule) => rule.enabled)
        .map((rule) => ({ name: rule.name, content: rule.content }))
    })

    return Service.of({ list, create, update, remove, enabledContents })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node, Global.node] })

export * as UserRule from "./user-rules"
