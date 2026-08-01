import { createContext, createEffect, createMemo, createSignal, onCleanup, onMount, useContext } from "solid-js"
import type { Accessor, ParentProps } from "solid-js"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { usePlatform } from "./platform"
import { useSettings } from "./settings"

// Each panel background variable maps to a Tailwind utility class. We override BOTH the
// CSS variable (with !important) AND the class directly, because inline custom-property
// overrides can lose to the theme's :root rules in Chromium's cascade.
const PANEL_VARS = [
  "--background-base",
  "--v2-background-bg-deep",
  "--v2-background-bg-base",
  "--v2-background-bg-layer-01",
  "--v2-background-bg-layer-02",
  "--color-background-stronger",
] as const

const PANEL_CLASS: Record<string, string> = {
  "--background-base": "bg-background-base",
  "--v2-background-bg-deep": "bg-v2-background-bg-deep",
  "--v2-background-bg-base": "bg-v2-background-bg-base",
  "--v2-background-bg-layer-01": "bg-v2-background-bg-layer-01",
  "--v2-background-bg-layer-02": "bg-v2-background-bg-layer-02",
  "--color-background-stronger": "bg-background-stronger",
}

// Fallback colours used when the DOM probe fails (e.g. theme CSS not yet applied).
const FALLBACK_DARK: Record<string, RGB> = {
  "--background-base": { r: 18, g: 18, b: 18 },
  "--v2-background-bg-deep": { r: 22, g: 22, b: 22 },
  "--v2-background-bg-base": { r: 18, g: 18, b: 18 },
  "--v2-background-bg-layer-01": { r: 22, g: 22, b: 22 },
  "--v2-background-bg-layer-02": { r: 30, g: 30, b: 30 },
  "--color-background-stronger": { r: 30, g: 30, b: 30 },
}
const FALLBACK_LIGHT: Record<string, RGB> = {
  "--background-base": { r: 248, g: 248, b: 248 },
  "--v2-background-bg-deep": { r: 241, g: 241, b: 241 },
  "--v2-background-bg-base": { r: 250, g: 250, b: 250 },
  "--v2-background-bg-layer-01": { r: 241, g: 241, b: 241 },
  "--v2-background-bg-layer-02": { r: 229, g: 229, b: 229 },
  "--color-background-stronger": { r: 229, g: 229, b: 229 },
}

// The image data URL can be several MB, which exceeds Chromium's CSS custom-property
// value length limit. All overrides are injected via a single dynamic <style> element.
const BG_IMAGE_STYLE_ID = "app-bg-image-layer"

type RGB = { r: number; g: number; b: number }

function readOpaqueColor(varName: string): RGB | null {
  if (typeof document === "undefined") return null
  const probe = document.createElement("div")
  probe.style.position = "fixed"
  probe.style.visibility = "hidden"
  probe.style.pointerEvents = "none"
  probe.style.backgroundColor = `var(${varName})`
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).backgroundColor
  probe.remove()
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (!match) return null
  const parts = match[1]!.split(",").map((part) => Number.parseFloat(part.trim()))
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null
  return { r: parts[0]!, g: parts[1]!, b: parts[2]! }
}

function clearOverrides() {
  if (typeof document === "undefined") return
  document.getElementById(BG_IMAGE_STYLE_ID)?.remove()
  document.body.removeAttribute("data-bg-image")
}

type BackgroundImageContext = {
  imageURL: Accessor<string | null>
  hasImage: Accessor<boolean>
  pick: () => Promise<void>
  clear: () => Promise<void>
}

const Context = createContext<BackgroundImageContext>()

export function useBackgroundImage(): BackgroundImageContext {
  const ctx = useContext(Context)
  if (!ctx) throw new Error("useBackgroundImage must be used within a BackgroundImageProvider")
  return ctx
}

export function BackgroundImageProvider(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettings()
  const theme = useTheme()

  const [imageURL, setImageURL] = createSignal<string | null>(null)
  const [panelColors, setPanelColors] = createSignal<Record<string, RGB>>({})

  onMount(() => {
    const promise = platform.getBackgroundImage?.()
    if (!promise) return
    void promise.then(
      (image) => {
        if (image) {
          setImageURL(image.dataURL)
          // If dim was persisted as 0 (panels fully opaque), bump to default so the
          // image is actually visible. The user can still lower it via the slider.
          if (settings.appearance.backgroundImage.dim() <= 0) {
            settings.appearance.backgroundImage.setDim(0.3)
          }
        }
      },
      () => setImageURL(null),
    )
  })

  createEffect(() => {
    const mode = theme.mode()
    theme.themeId()
    const fallback = mode === "dark" ? FALLBACK_DARK : FALLBACK_LIGHT
    const colors: Record<string, RGB> = {}
    for (const name of PANEL_VARS) {
      const rgb = readOpaqueColor(name) ?? fallback[name]
      if (rgb) colors[name] = rgb
    }
    setPanelColors(colors)
  })

  createEffect(() => {
    const enabled = settings.appearance.backgroundImage.enabled()
    const opacity = settings.appearance.backgroundImage.opacity()
    const blur = settings.appearance.backgroundImage.blur()
    const size = settings.appearance.backgroundImage.size()
    const repeat = settings.appearance.backgroundImage.repeat()
    const dim = settings.appearance.backgroundImage.dim()
    const url = imageURL()
    const colors = panelColors()

    if (typeof document === "undefined") return
    clearOverrides()

    // enabled=true with no file falls back to a solid background silently without
    // persisting enabled=false, so external file removal doesn't pollute user prefs.
    if (!enabled || !url) return

    const alpha = 1 - dim

    // Build CSS that overrides panel backgrounds via THREE mechanisms:
    // 1. CSS variable override with !important (beats theme's :root rules)
    // 2. Direct Tailwind class targeting with !important (beats any var() resolution issue)
    // 3. *-opaque variants for floating elements (dialogs, menus) that must stay readable
    const varRules: string[] = []
    const classRules: string[] = []
    for (const name of PANEL_VARS) {
      const rgb = colors[name]
      if (!rgb) continue
      varRules.push(`  ${name}: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha}) !important;`)
      varRules.push(`  ${name}-opaque: rgb(${rgb.r}, ${rgb.g}, ${rgb.b});`)
      const cls = PANEL_CLASS[name]
      if (cls) {
        classRules.push(
          `body[data-bg-image="true"] .${cls}{background-color:rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha}) !important;}`,
        )
      }
    }

    const css = `:root {
${varRules.join("\n")}
}
${classRules.join("\n")}
body[data-bg-image="true"]::before{
  background-image:url("${url}");
  opacity:${opacity};
  filter:blur(${blur}px);
  background-size:${size};
  background-repeat:${repeat ? "repeat" : "no-repeat"};
}`

    const styleEl = (document.getElementById(BG_IMAGE_STYLE_ID) as HTMLStyleElement | null) ?? (() => {
      const el = document.createElement("style")
      el.id = BG_IMAGE_STYLE_ID
      document.head.appendChild(el)
      return el
    })()
    styleEl.textContent = css

    document.body.setAttribute("data-bg-image", "true")
  })

  onCleanup(() => clearOverrides())

  const pick = async () => {
    const image = await platform.pickBackgroundImage?.()?.catch(() => null)
    if (!image) return
    setImageURL(image.dataURL)
    settings.appearance.backgroundImage.setEnabled(true)
    if (settings.appearance.backgroundImage.dim() <= 0) {
      settings.appearance.backgroundImage.setDim(0.3)
    }
  }

  const clear = async () => {
    await platform.clearBackgroundImage?.()?.catch(() => undefined)
    setImageURL(null)
    settings.appearance.backgroundImage.setEnabled(false)
  }

  const value: BackgroundImageContext = {
    imageURL,
    hasImage: createMemo(() => imageURL() !== null),
    pick,
    clear,
  }

  return <Context.Provider value={value}>{props.children}</Context.Provider>
}
