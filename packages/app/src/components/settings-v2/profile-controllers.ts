import { createMemo, createResource, createSignal, type Accessor } from "solid-js"
import type { SkillV2Info } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"

/**
 * Two-state skill source mode for a session profile. `inherit` keeps the
 * global `.opencode` skills alongside the current project's `.opencode`
 * skills; `deny` restricts the effective skills to the current project only.
 */
export type SkillMode = "inherit" | "deny"

/**
 * Controller for the session-level Profile settings tab. Mirrors
 * `createPermissionScopeController` for directory resolution and the v2 SDK
 * wiring. The skill mode is persisted in the project `opencode.json` under
 * `profile.skills.mode`; the matching instance is disposed after the write so
 * the next instance rebuild rescans skills with the new mode.
 *
 * Mode switches use an optimistic override so the SelectV2 reflects the new
 * value instantly — no spinner, no disabled state. The skills list refetches
 * after a short delay to let the server-side instance rebuild settle.
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

  // Capability signal: a failed profile fetch (404 on an older server without
  // `serverRoutes`, or any transport error) flips this to false and the UI
  // renders the unsupported notice. `profile.error` is undefined while
  // loading or on success, so the profile panel stays mounted.
  const [profile] = createResource(sessionID, async (id) => {
    if (!id) return undefined
    const result = await serverSdk().client.v2.session.profile({ sessionID: id })
    return result.data?.data?.session
  })
  const supported = createMemo(() => !profile.error)

  // List skills effective in the session directory. The server already
  // restricts discovery to the project when the profile mode is `"deny"`, so
  // this list reflects the mode configured for the current project.
  const [skills, { refetch: refetchSkills }] = createResource(directory, async (dir) => {
    if (!dir) return [] as SkillV2Info[]
    const result = await serverSdk().client.v2.skill.list({ location: { directory: dir } })
    return result.data?.data ?? []
  })

  // The project config resolves the authoritative mode: an unset `mode` falls
  // back to the `inherit` default.
  const [config, { refetch: refetchConfig }] = createResource(directory, async (dir) => {
    if (!dir) return undefined
    const result = await serverSdk().client.config.get({ directory: dir })
    return result.data
  })

  // Optimistic override: set immediately on mode switch so the SelectV2
  // updates without waiting for the config refetch. Cleared once the config
  // resource confirms the write (or on error, rolling back to the config
  // value). A separate `modeUpdating` flag prevents concurrent switches
  // without disabling the control visually.
  const [modeOverride, setModeOverride] = createSignal<SkillMode | undefined>(undefined)
  let modeUpdating = false
  const mode = createMemo<SkillMode>(
    () => modeOverride() ?? (config()?.profile?.skills?.mode as SkillMode | undefined) ?? "inherit",
  )

  // Poll the skills list a few times so it refreshes as soon as the
  // server-side instance rebuild settles, instead of guessing a fixed delay
  // that may be too short (stale data) or too long (unnecessary wait).
  const pollSkills = async (retries = 3, delay = 300) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      await refetchSkills()
    }
  }

  const setMode = async (next: SkillMode) => {
    const dir = directory()
    if (!dir || modeUpdating) return
    modeUpdating = true
    setModeOverride(next)
    try {
      const existing = await serverSdk().client.config.get({ directory: dir }).then((result) => result.data)
      const nextConfig = {
        ...existing,
        profile: { ...existing?.profile, skills: { ...existing?.profile?.skills, mode: next } },
      }
      await serverSdk().client.config.update({ directory: dir, config: nextConfig })
      // The config write disposes the instance and the server sends a
      // `config.updated` event that triggers a full directory re-bootstrap
      // via serverSync. Wait for that re-bootstrap to settle BEFORE refetching
      // our own resources — running them concurrently causes a double
      // re-render (the re-bootstrap plus our refetch) which visibly flashes
      // the entire interface. The override stays active until the refetch
      // confirms the write so the SelectV2 never shows a stale value.
      await new Promise((resolve) => setTimeout(resolve, 500))
      await refetchConfig()
      setModeOverride(undefined)
      void refetchSkills()
    } catch (error) {
      setModeOverride(undefined)
      showToast({
        title: language.t("settings.profile.skills.modeError"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    } finally {
      modeUpdating = false
    }
  }

  // Register extra skill folders in the project config (`skills.paths`) via
  // the V1 config route. The update handler marks the instance for disposal,
  // so the next instance rebuild rescans skills; poll the skills list with
  // short retries so we refetch as soon as the rebuild settles rather than
  // guessing a fixed delay that may be too short (stale data) or too long.
  const addSkillDirectories = async (paths: string[]) => {
    const dir = directory()
    if (!dir || paths.length === 0) return
    try {
      const existing = await serverSdk().client.config.get({ directory: dir }).then((result) => result.data)
      const merged = Array.from(new Set([...(existing?.skills?.paths ?? []), ...paths]))
      await serverSdk().client.config.update({ directory: dir, config: { skills: { paths: merged } } })
      await pollSkills()
    } catch (error) {
      showToast({
        title: language.t("settings.profile.skills.addError"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    }
  }

  return {
    enabled,
    supported,
    directory,
    loading: () => skills.loading || profile.loading,
    skills: () => skills.latest ?? [],
    mode,
    setMode,
    addSkillDirectories,
  }
}

export type ProfileController = ReturnType<typeof createProfileController>