import { createMemo, createResource, type Accessor } from "solid-js"
import type { ProfileSnapshot, ProfileSelection, SkillV2Info } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"

/**
 * Three-state selection a user can express for a single skill within a
 * session profile. `inherit` defers to the effective config+session merge
 * (no explicit allow/disable entry); `allowed`/`disabled` write an explicit
 * entry into `ProfileSelection.enable`/`disable`.
 */
export type SkillState = "inherit" | "allowed" | "disabled"

/**
 * Controller for the session-level Profile settings tab. Mirrors
 * `createPermissionScopeController` for directory resolution and the v2 SDK
 * wiring. Reads `session.profile` (GET), writes via `session.profile2.set`,
 * and resets via `session.profile2.reset`.
 *
 * The config-level profile is merged into the effective profile by the runner
 * via field-level overlay; the UI does not display the merged result because
 * the config-level profile is not exposed through the legacy `/config`
 * endpoint (which is bound to `ConfigV1.Info`). Optimistic updates mutate the
 * `sessionProfile` resource immediately and roll back on failure, so the UI
 * never blocks on the round trip.
 */
export function createProfileController(sessionID: Accessor<string | undefined>) {
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const language = useLanguage()

  const directory = createMemo(() => {
    const id = sessionID()
    if (!id) return undefined
    return serverSync().session.lineage.peek(id)?.session.directory
  })

  const enabled = createMemo(() => !!sessionID() && !!directory())

  // Read the session-level profile snapshot. The V1 sidecar also serves the
  // V2 `/api/session/:id/profile` route (via `serverRoutes`), so we call it
  // unconditionally and let a fetch failure (`sessionProfile.error`) drive the
  // unsupported notice — `supported` below is the capability signal.
  const [sessionProfile, { mutate: setSessionProfile, refetch: refetchSessionProfile }] =
    createResource(sessionID, async (id) => {
      if (!id) return undefined
      const result = await serverSdk().client.v2.session.profile({ sessionID: id })
      return result.data?.data?.session
    })

  // List skills available in the session directory. `name` is the key matched
  // against `ProfileSelection` patterns. Shares the same capability signal as
  // the profile fetch: both routes ship together in `serverRoutes`.
  const [skills] = createResource(directory, async (dir) => {
    if (!dir) return [] as SkillV2Info[]
    const result = await serverSdk().client.v2.skill.list({ location: { directory: dir } })
    return result.data?.data ?? []
  })

  // Capability signal: a failed profile fetch (404 on an older server without
  // `serverRoutes`, or any transport error) flips this to false and the UI
  // renders the unsupported notice. `sessionProfile.error` is undefined while
  // loading or on success, so the profile panel stays mounted.
  const supported = createMemo(() => !sessionProfile.error)

  const persist = async (next: ProfileSnapshot | undefined) => {
    const id = sessionID()
    if (!id) return
    const previous = sessionProfile.latest
    setSessionProfile(next)
    try {
      await serverSdk().client.v2.session.profile2.set({ sessionID: id, profile: next ?? {} })
      void refetchSessionProfile()
    } catch (error) {
      setSessionProfile(previous)
      showToast({
        title: language.t("settings.profile.error.persist"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    }
  }

  const reset = async () => {
    const id = sessionID()
    if (!id) return
    const previous = sessionProfile.latest
    setSessionProfile(undefined)
    try {
      await serverSdk().client.v2.session.profile2.reset({ sessionID: id })
      void refetchSessionProfile()
    } catch (error) {
      setSessionProfile(previous)
      showToast({
        title: language.t("settings.profile.error.reset"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    }
  }

  const skillState = (name: string): SkillState => {
    const selection = sessionProfile.latest?.skills?.selection
    if (!selection) return "inherit"
    if (selection.disable?.some((pattern) => pattern === name)) return "disabled"
    const enable = selection.enable
    if (enable && enable.length > 0) {
      // Non-empty allow-list: only listed entries are allowed, everything else
      // is implicitly disabled.
      return enable.some((pattern) => pattern === name) ? "allowed" : "disabled"
    }
    return "inherit"
  }

  const setSkillState = (name: string, state: SkillState) => {
    const current = sessionProfile.latest ?? {}
    const skills = current.skills ?? {}
    const selection = skills.selection ?? {}
    // Drop any existing entry for this skill before writing the new state.
    const enable = (selection.enable ?? []).filter((pattern) => pattern !== name)
    const disable = (selection.disable ?? []).filter((pattern) => pattern !== name)
    if (state === "allowed") enable.push(name)
    else if (state === "disabled") disable.push(name)
    // Omit emptied arrays so an undefined selection restores identity semantics.
    const nextSelection: ProfileSelection = {}
    if (enable.length > 0) nextSelection.enable = enable
    if (disable.length > 0) nextSelection.disable = disable
    const nextSkills = { ...skills }
    if (Object.keys(nextSelection).length > 0) nextSkills.selection = nextSelection
    else delete nextSkills.selection
    const next: ProfileSnapshot = { ...current }
    if (Object.keys(nextSkills).length > 0) next.skills = nextSkills
    else delete next.skills
    void persist(next)
  }

  const setInline = (text: string) => {
    const current = sessionProfile.latest ?? {}
    const rules = current.rules ?? {}
    const nextRules = { ...rules }
    if (text.trim() === "") delete nextRules.inline
    else nextRules.inline = text
    const next: ProfileSnapshot = { ...current }
    if (Object.keys(nextRules).length > 0) next.rules = nextRules
    else delete next.rules
    void persist(next)
  }

  const setInstructions = (paths: string[]) => {
    const current = sessionProfile.latest ?? {}
    const rules = current.rules ?? {}
    const nextRules = { ...rules }
    const cleaned = paths.map((p) => p.trim()).filter((p) => p !== "")
    if (cleaned.length === 0) delete nextRules.instructions
    else nextRules.instructions = cleaned
    const next: ProfileSnapshot = { ...current }
    if (Object.keys(nextRules).length > 0) next.rules = nextRules
    else delete next.rules
    void persist(next)
  }

  return {
    enabled,
    supported,
    loading: () => sessionProfile.loading || skills.loading,
    skills: () => skills.latest ?? [],
    sessionProfile: () => sessionProfile.latest,
    skillState,
    setSkillState,
    setInline,
    setInstructions,
    reset,
  }
}

export type ProfileController = ReturnType<typeof createProfileController>
