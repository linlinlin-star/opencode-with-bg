import { app, Menu, nativeImage, Tray } from "electron"
import { iconPath } from "./windows"

type SessionSummary = { id: string; title: string; directory: string }

type ServerCreds = { url: string; username: string | null; password: string | null }

type TrayDeps = {
  showWindow: () => void
  newSession: () => void
  openSession: (directory: string, sessionId: string) => void
  quit: () => void
  server: ServerCreds | null
}

// Keep a module-level reference so the Tray is not garbage-collected (a
// collected Tray disappears from the system tray without warning).
let tray: Tray | null = null
// Recent-sessions cache populated from the sidecar; refreshed on tray creation
// and on each right-click so the menu opens instantly with stale data while a
// fresh fetch runs in the background.
let recentSessions: SessionSummary[] = []

export function createTray(deps: TrayDeps) {
  // A previously-created tray (e.g. during a relaunch in the same process)
  // must be destroyed before creating a new one.
  tray?.destroy()

  const icon = nativeImage.createFromPath(iconPath())
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip(app.getName())

  tray.on("click", () => deps.showWindow())

  tray.on("right-click", () => {
    // Pop up the menu immediately with cached data, then refresh for the next
    // open so the user never waits on a fetch to see the menu.
    tray?.popUpContextMenu(buildMenu(deps))
    void refreshRecentSessions(deps.server)
  })

  // Seed the cache so the first right-click already shows sessions.
  void refreshRecentSessions(deps.server)

  return tray
}

async function refreshRecentSessions(server: ServerCreds | null) {
  if (!server) return
  try {
    const url = new URL("/api/session", server.url)
    url.searchParams.set("limit", "8")
    url.searchParams.set("order", "desc")
    const headers = new Headers()
    if (server.password) {
      const user = server.username ?? "opencode"
      headers.set("authorization", `Basic ${Buffer.from(`${user}:${server.password}`).toString("base64")}`)
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) })
    if (!res.ok) return
    const json = (await res.json()) as {
      data?: Array<{ id: string; title?: string; directory?: string }>
    }
    recentSessions = (json.data ?? [])
      .filter((s) => s.id && s.directory)
      .map((s) => ({ id: s.id, title: s.title?.trim() || "Untitled", directory: s.directory as string }))
  } catch {
    // keep the existing cache on failure
  }
}

function buildMenu(deps: TrayDeps) {
  const recent =
    recentSessions.length > 0
      ? recentSessions.map((s) => ({
          label: truncate(s.title, 48),
          click: () => deps.openSession(s.directory, s.id),
        }))
      : [{ label: "No recent sessions", enabled: false }]

  return Menu.buildFromTemplate([
    { label: "Show OpenCode", click: () => deps.showWindow() },
    { label: "New Session", click: () => deps.newSession() },
    { label: "Recent Sessions", submenu: recent },
    { type: "separator" },
    { label: "Quit", click: () => deps.quit() },
  ])
}

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text
}
