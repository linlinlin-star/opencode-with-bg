import { marked, type Tokens } from "marked"

const renderer = new marked.Renderer()

renderer.link = ({ href, title, text }: Tokens.Link) => {
  // text is rendered by marked and may contain inline HTML; it relies on the
  // caller's DOMPurify pass (see session-ui markdown-cache) for final sanitization.
  return `<a href="${escapeHtml(sanitizeHref(href))}"${title ? ` title="${escapeHtml(title)}"` : ""} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
}

export function parseMarkdown(input: string) {
  return marked(input, {
    renderer,
    breaks: false,
    gfm: true,
  })
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

// Drop dangerous schemes (javascript:, data:, vbscript:, …) and protocol-relative
// URLs (//evil.com). Allow anchor fragments and a small allowlist of protocols.
function sanitizeHref(href: string) {
  const trimmed = href.trim()
  if (trimmed.startsWith("#")) return trimmed
  if (trimmed.startsWith("//")) return ""
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (match) {
    const scheme = match[1]?.toLowerCase()
    if (scheme && !["http", "https", "mailto", "tel", "ftp"].includes(scheme)) return ""
  }
  return trimmed
}
