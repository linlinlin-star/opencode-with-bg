import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { createMemo, onCleanup } from "solid-js"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useCommand, type CommandOption } from "@/context/command"
import { useGlobal } from "@/context/global"
import { useLanguage, type Locale } from "@/context/language"
import { useLayout } from "@/context/layout"
import { ServerConnection, useServer } from "@/context/server"
import { useTabs, type Tab } from "@/context/tabs"
import { showToast } from "@/utils/toast"

const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
const colorSchemeKey = {
  system: "theme.scheme.system",
  light: "theme.scheme.light",
  dark: "theme.scheme.dark",
} as const

// LegacyLayout registers a large block of commands (project/session navigation,
// theme/language cycling, provider/server dialogs) that the new layout shell
// never mounts. Re-register the subset that the File/View/Go menus expose and
// the theme/language cycle keybinds so the menu items are not disabled and the
// palette/keybinds keep working under the new layout.
export function useNewLayoutCommands() {
  const command = useCommand()
  const language = useLanguage()
  const server = useServer()
  const global = useGlobal()
  const tabs = useTabs()
  const layout = useLayout()
  const theme = useTheme()
  const dialog = useDialog()
  const pickDirectory = useDirectoryPicker()

  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const themeEntries = createMemo(() => theme.ids().map((id) => [id, theme.themes()[id]] as const))

  function projectsList() {
    const conn = server.current
    if (!conn) return []
    return global.ensureServerCtx(conn).projects.list()
  }

  function chooseProject() {
    const conn = server.current
    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const directories = Array.isArray(result) ? result : result ? [result] : []
        const directory = directories[0]
        if (!directory) return
        const ctx = global.ensureServerCtx(conn)
        directories.forEach((item) => ctx.projects.open(item))
        ctx.projects.touch(directory)
        void tabs.newDraft({ server: ServerConnection.key(conn), directory })
      },
    })
  }

  // The new layout is tab-based, so the "current project" is the project of the
  // active draft tab, or the last-selected home project when on the home view.
  const currentDirectory = createMemo(() => {
    const route = layout.route()
    if (route.type === "draft") {
      const tab = tabs.store.find((tab): tab is Extract<Tab, { type: "draft" }> => tab.type === "draft" && tab.draftID === route.draftID)
      if (tab) return tab.directory
    }
    return layout.home.selection().directory
  })

  function navigateProjectByOffset(offset: number) {
    const projects = projectsList()
    if (projects.length === 0) return
    const current = currentDirectory()
    const index = current
      ? projects.findIndex((project) => project.worktree === current || project.sandboxes?.some((sandbox) => sandbox === current))
      : -1
    const target =
      index === -1
        ? offset > 0
          ? projects[0]
          : projects[projects.length - 1]
        : projects[(index + offset + projects.length) % projects.length]
    if (!target) return
    const conn = server.current
    if (!conn) return
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.touch(target.worktree)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory: target.worktree })
  }

  const currentTab = createMemo<Tab | undefined>(() => {
    const route = layout.route()
    if (route.type === "draft") {
      return tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)
    }
    if (route.type === "session") {
      return tabs.store.find(
        (tab) => tab.type === "session" && tab.sessionId === route.sessionId && (route.server === undefined || tab.server === route.server),
      )
    }
    return undefined
  })

  function selectAdjacentTab(offset: number) {
    const list = tabs.store
    if (list.length === 0) return
    const current = currentTab()
    const index = current ? list.findIndex((tab) => tab === current) : -1
    const targetIndex =
      index === -1 ? (offset > 0 ? 0 : list.length - 1) : (index + offset + list.length) % list.length
    const target = list[targetIndex]
    if (target) tabs.select(target)
  }

  function newSession() {
    // Delegate to the titlebar's tab.new command, which handles all cases
    // (active session, draft, home selection, fallback) including model
    // inheritance. tab.new is registered by Titlebar, always mounted in the
    // new layout. trigger() is a no-op if the command is not yet registered.
    command.trigger("tab.new")
  }

  function connectProvider() {
    void import("@/components/dialog-connect-provider").then((module) => {
      if (disposed) return
      void dialog.show(() => <module.DialogConnectProvider />)
    })
  }

  function openServer() {
    void import("@/components/dialog-select-server").then((module) => {
      if (disposed) return
      dialog.show(() => <module.DialogSelectServer />)
    })
  }

  function cycleTheme(direction = 1) {
    const ids = themeEntries().map(([id]) => id)
    if (ids.length === 0) return
    const currentIndex = ids.indexOf(theme.themeId())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + ids.length) % ids.length
    const nextThemeId = ids[nextIndex]
    theme.setTheme(nextThemeId)
    showToast({ title: language.t("toast.theme.title"), description: theme.name(nextThemeId) })
  }

  function cycleColorScheme(direction = 1) {
    const current = theme.colorScheme()
    const currentIndex = colorSchemeOrder.indexOf(current)
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + direction + colorSchemeOrder.length) % colorSchemeOrder.length
    const next = colorSchemeOrder[nextIndex]
    theme.setColorScheme(next)
    showToast({ title: language.t("toast.scheme.title"), description: language.t(colorSchemeKey[next]) })
  }

  function setLocale(next: Locale) {
    if (next === language.locale()) return
    language.setLocale(next)
    showToast({
      title: language.t("toast.language.title"),
      description: language.t("toast.language.description", { language: language.label(next) }),
    })
  }

  function cycleLanguage(direction = 1) {
    const locales = language.locales
    const currentIndex = locales.indexOf(language.locale())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + locales.length) % locales.length
    const next = locales[nextIndex]
    if (!next) return
    setLocale(next)
  }

  command.register("new-layout", () => {
    const commands: CommandOption[] = [
      {
        id: "project.open",
        title: language.t("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "project.previous",
        title: language.t("command.project.previous"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowup",
        onSelect: () => navigateProjectByOffset(-1),
      },
      {
        id: "project.next",
        title: language.t("command.project.next"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowdown",
        onSelect: () => navigateProjectByOffset(1),
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => selectAdjacentTab(-1),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => selectAdjacentTab(1),
      },
      {
        id: "session.new",
        title: language.t("command.session.new"),
        category: language.t("command.category.session"),
        disabled: projectsList().length === 0,
        onSelect: () => newSession(),
      },
      {
        id: "sidebar.toggle",
        title: language.t("command.sidebar.toggle"),
        category: language.t("command.category.view"),
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        category: language.t("command.category.provider"),
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      // mod+shift+t is taken by tab.reopenClosed in the new layout, so theme
      // cycling is palette-only here.
      {
        id: "theme.cycle",
        title: language.t("command.theme.cycle"),
        category: language.t("command.category.theme"),
        onSelect: () => cycleTheme(1),
      },
      {
        id: "theme.scheme.cycle",
        title: language.t("command.theme.scheme.cycle"),
        category: language.t("command.category.theme"),
        keybind: "mod+shift+s",
        onSelect: () => cycleColorScheme(1),
      },
      {
        id: "language.cycle",
        title: language.t("command.language.cycle"),
        category: language.t("command.category.language"),
        onSelect: () => cycleLanguage(1),
      },
    ]

    for (const [id] of themeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: language.t("command.theme.set", { theme: theme.name(id) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewTheme(id)
          return () => theme.cancelPreview()
        },
      })
    }

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: language.t("command.theme.scheme.set", { scheme: language.t(colorSchemeKey[scheme]) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
      })
    }

    for (const locale of language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: language.t("command.language.set", { language: language.label(locale) }),
        category: language.t("command.category.language"),
        onSelect: () => setLocale(locale),
      })
    }

    return commands
  })
}
