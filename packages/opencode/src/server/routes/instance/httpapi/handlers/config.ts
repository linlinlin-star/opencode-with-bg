import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { EffectBridge } from "@/effect/bridge"
import * as InstanceState from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service
    const store = yield* InstanceStore.Service
    const locations = yield* LocationServiceMap.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      const instance = yield* InstanceState.context
      const bridge = yield* EffectBridge.make()
      yield* bridge.run(
        store.reload({
          directory: instance.directory,
          worktree: instance.directory,
          project: instance.project,
        }),
      )
      // V2 sidecar services read location config once per location open; drop
      // the cached location so the next V2 request re-reads the updated file.
      // Mirror LocationMiddleware.ref(): workspaceID must be present (undefined)
      // so the key hashes identically to the location opened by V2 requests.
      const ref = Location.Ref.make({
        directory: AbsolutePath.make(instance.directory),
        workspaceID: undefined,
      })
      yield* locations.invalidate(ref)
      yield* Effect.logInfo("config update invalidated V2 location", { directory: instance.directory })
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    return handlers.handle("get", get).handle("update", update).handle("providers", providers)
  }),
)
