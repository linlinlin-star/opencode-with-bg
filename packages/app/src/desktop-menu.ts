export type DesktopMenuPlatform = "macos" | "windows"

export type DesktopMenuAction =
  | "app.checkForUpdates"
  | "app.relaunch"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "view.reload"
  | "view.toggleDevTools"
  | "view.resetZoom"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.toggleFullscreen"
  | "window.new"
  | "window.close"
  | "window.minimize"
  | "window.toggleMaximize"

export type DesktopMenuRole =
  | "about"
  | "close"
  | "copy"
  | "cut"
  | "hide"
  | "hideOthers"
  | "paste"
  | "quit"
  | "redo"
  | "reload"
  | "resetZoom"
  | "selectAll"
  | "toggleDevTools"
  | "togglefullscreen"
  | "undo"
  | "unhide"
  | "windowMenu"
  | "zoomIn"
  | "zoomOut"

export type DesktopMenuItem = {
  type: "item"
  label?: string
  labelKey?: string
  command?: string
  action?: DesktopMenuAction
  role?: DesktopMenuRole
  href?: string
  accelerator?: Partial<Record<DesktopMenuPlatform, string>>
  enabled?: "updater"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuSeparator = {
  type: "separator"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuEntry = DesktopMenuItem | DesktopMenuSeparator

export type DesktopMenu = {
  id: string
  label: string
  labelKey?: string
  role?: DesktopMenuRole
  items?: DesktopMenuEntry[]
  platforms?: DesktopMenuPlatform[]
}

export const DESKTOP_MENU: DesktopMenu[] = [
  {
    id: "app",
    label: "OpenCode",
    platforms: ["macos"],
    items: [
      { type: "item", role: "about" },
      { type: "item", label: "Check for Updates...", action: "app.checkForUpdates", enabled: "updater" },
      { type: "item", label: "Settings", command: "settings.open", accelerator: { macos: "Cmd+," } },
      { type: "item", label: "Reload Webview", action: "view.reload" },
      { type: "item", label: "Restart", action: "app.relaunch" },
      { type: "item", label: "Export Logs...", command: "logs.export" },
      { type: "separator" },
      { type: "item", role: "hide" },
      { type: "item", role: "hideOthers" },
      { type: "item", role: "unhide" },
      { type: "separator" },
      { type: "item", role: "quit" },
    ],
  },
  {
    id: "file",
    label: "File",
    labelKey: "desktopMenu.file",
    items: [
      {
        type: "item",
        label: "New Session",
        labelKey: "desktopMenu.newSession",
        command: "session.new",
        accelerator: { macos: "Shift+Cmd+S" },
      },
      {
        type: "item",
        label: "Open Project...",
        labelKey: "desktopMenu.openProject",
        command: "project.open",
        accelerator: { macos: "Cmd+O" },
      },
      {
        type: "item",
        label: "Settings",
        labelKey: "desktopMenu.settings",
        command: "settings.open",
        accelerator: { windows: "Ctrl+," },
        platforms: ["windows"],
      },
      {
        type: "item",
        label: "New Window",
        labelKey: "desktopMenu.newWindow",
        action: "window.new",
        accelerator: { macos: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Close Window",
        labelKey: "desktopMenu.closeWindow",
        action: "window.close",
        role: "close",
      },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    labelKey: "desktopMenu.edit",
    items: [
      {
        type: "item",
        label: "Undo",
        labelKey: "desktopMenu.undo",
        action: "edit.undo",
        role: "undo",
        accelerator: { windows: "Ctrl+Z" },
      },
      {
        type: "item",
        label: "Redo",
        labelKey: "desktopMenu.redo",
        action: "edit.redo",
        role: "redo",
        accelerator: { windows: "Ctrl+Y" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Cut",
        labelKey: "desktopMenu.cut",
        action: "edit.cut",
        role: "cut",
        accelerator: { windows: "Ctrl+X" },
      },
      {
        type: "item",
        label: "Copy",
        labelKey: "desktopMenu.copy",
        action: "edit.copy",
        role: "copy",
        accelerator: { windows: "Ctrl+C" },
      },
      {
        type: "item",
        label: "Paste",
        labelKey: "desktopMenu.paste",
        action: "edit.paste",
        role: "paste",
        accelerator: { windows: "Ctrl+V" },
      },
      { type: "item", label: "Delete", labelKey: "desktopMenu.delete", action: "edit.delete" },
      {
        type: "item",
        label: "Select All",
        labelKey: "desktopMenu.selectAll",
        action: "edit.selectAll",
        role: "selectAll",
        accelerator: { windows: "Ctrl+A" },
      },
    ],
  },
  {
    id: "view",
    label: "View",
    labelKey: "desktopMenu.view",
    items: [
      {
        type: "item",
        label: "Toggle Sidebar",
        labelKey: "desktopMenu.toggleSidebar",
        command: "sidebar.toggle",
      },
      {
        type: "item",
        label: "Toggle Terminal",
        labelKey: "desktopMenu.toggleTerminal",
        command: "terminal.toggle",
        accelerator: { macos: "Ctrl+`" },
      },
      {
        type: "item",
        label: "Toggle File Tree",
        labelKey: "desktopMenu.toggleFileTree",
        command: "fileTree.toggle",
      },
      { type: "separator" },
      { type: "item", label: "Reload", labelKey: "desktopMenu.reload", action: "view.reload", role: "reload" },
      {
        type: "item",
        label: "Toggle Developer Tools",
        labelKey: "desktopMenu.toggleDevTools",
        action: "view.toggleDevTools",
        role: "toggleDevTools",
      },
      { type: "separator" },
      {
        type: "item",
        label: "Actual Size",
        labelKey: "desktopMenu.actualSize",
        action: "view.resetZoom",
        role: "resetZoom",
        accelerator: { windows: "Ctrl+0" },
      },
      {
        type: "item",
        label: "Zoom In",
        labelKey: "desktopMenu.zoomIn",
        action: "view.zoomIn",
        role: "zoomIn",
        accelerator: { windows: "Ctrl++" },
      },
      {
        type: "item",
        label: "Zoom Out",
        labelKey: "desktopMenu.zoomOut",
        action: "view.zoomOut",
        role: "zoomOut",
        accelerator: { windows: "Ctrl+-" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Toggle Full Screen",
        labelKey: "desktopMenu.toggleFullScreen",
        action: "view.toggleFullscreen",
        role: "togglefullscreen",
      },
    ],
  },
  {
    id: "go",
    label: "Go",
    labelKey: "desktopMenu.go",
    items: [
      { type: "item", label: "Back", labelKey: "desktopMenu.back", command: "common.goBack", accelerator: { macos: "Cmd+[" } },
      {
        type: "item",
        label: "Forward",
        labelKey: "desktopMenu.forward",
        command: "common.goForward",
        accelerator: { macos: "Cmd+]" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Previous Session",
        labelKey: "desktopMenu.previousSession",
        command: "session.previous",
        accelerator: { macos: "Option+Up" },
      },
      {
        type: "item",
        label: "Next Session",
        labelKey: "desktopMenu.nextSession",
        command: "session.next",
        accelerator: { macos: "Option+Down" },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Previous Project",
        labelKey: "desktopMenu.previousProject",
        command: "project.previous",
        accelerator: { macos: "Cmd+Option+Up" },
      },
      {
        type: "item",
        label: "Next Project",
        labelKey: "desktopMenu.nextProject",
        command: "project.next",
        accelerator: { macos: "Cmd+Option+Down" },
      },
    ],
  },
  {
    id: "window",
    label: "Window",
    labelKey: "desktopMenu.window",
    role: "windowMenu",
    items: [
      { type: "item", label: "Minimize", labelKey: "desktopMenu.minimize", action: "window.minimize" },
      { type: "item", label: "Maximize", labelKey: "desktopMenu.maximize", action: "window.toggleMaximize" },
      { type: "separator" },
      { type: "item", label: "Close Window", labelKey: "desktopMenu.closeWindow", action: "window.close" },
    ],
  },
  {
    id: "help",
    label: "Help",
    labelKey: "desktopMenu.help",
    items: [
      {
        type: "item",
        label: "OpenCode Documentation",
        labelKey: "desktopMenu.documentation",
        href: "https://opencode.ai/docs",
      },
      { type: "item", label: "Support Forum", labelKey: "desktopMenu.supportForum", href: "https://discord.com/invite/opencode" },
      { type: "item", label: "Export Logs...", labelKey: "desktopMenu.exportLogs", command: "logs.export" },
      { type: "separator" },
      {
        type: "item",
        label: "Share Feedback",
        labelKey: "desktopMenu.shareFeedback",
        href: "https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml",
      },
      {
        type: "item",
        label: "Report a Bug",
        labelKey: "desktopMenu.reportBug",
        href: "https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml",
      },
    ],
  },
]

export function desktopMenuVisible(item: { platforms?: DesktopMenuPlatform[] }, platform: DesktopMenuPlatform) {
  return !item.platforms || item.platforms.includes(platform)
}
