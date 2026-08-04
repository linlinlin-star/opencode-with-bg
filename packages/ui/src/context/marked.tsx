import { getSharedHighlighter } from "@pierre/diffs"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { createSimpleContext } from "./helper"
import { createMarkdownParser } from "./marked-parser"
import { registerOpenCodeTheme } from "./marked-theme-register"

export { OpenCodeTheme } from "./marked-theme"

registerOpenCodeTheme()

// Wrap mermaid source into a placeholder div. The source is base64-encoded UTF-8
// so it survives HTML parsing and DOMPurify without colliding with quote/bracket
// characters in the diagram source. The rendering layer decodes and renders it.
function wrapMermaid(source: string): string {
  const bytes = new TextEncoder().encode(source)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `<div class="mermaid-diagram" data-source="${btoa(binary)}"></div>`
}

export const { use: useMarked, provider: MarkedProvider } = createSimpleContext({
  name: "Marked",
  init: () =>
    createMarkdownParser(async (code, language) => {
      if (language === "mermaid") return wrapMermaid(code)
      const highlighter = await getSharedHighlighter({
        themes: ["OpenCode"],
        langs: [],
        preferredHighlighter: "shiki-wasm",
      })
      const name = language in bundledLanguages ? language : "text"
      if (!highlighter.getLoadedLanguages().includes(name)) await highlighter.loadLanguage(name as BundledLanguage)
      return highlighter.codeToHtml(code, {
        lang: name,
        theme: "OpenCode",
        tabindex: false,
      })
    }),
})
