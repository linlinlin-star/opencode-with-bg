async function main() {
  const targets = await fetch("http://127.0.0.1:9222/json").then((r) => r.json())
  const page = targets.find((t) => t.type === "page" && t.title === "OpenCode")
  if (!page) { console.log("No OpenCode page"); process.exit(1) }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const consoleMsgs = []

  function send(method, params = {}) {
    const msgId = ++id
    return new Promise((resolve) => {
      pending.set(msgId, resolve)
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  }

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = msg.params.args.map(a => a.value || a.description || '').join(' ')
      if (args && !args.includes('vite') && !args.includes('Security')) consoleMsgs.push(`[${msg.params.type}] ${args.substring(0, 300)}`)
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleMsgs.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description?.substring(0, 200) || ''}`)
    }
  })

  await new Promise((resolve) => ws.addEventListener("open", resolve))
  await send("Runtime.enable")

  // Click the "Add Project" button
  console.log("Clicking Add Project button...")
  const clickResult = await send("Runtime.evaluate", {
    expression: `(function() {
      const addBtn = document.querySelector('[data-action*="add-project"]')
      if (!addBtn) return "add project button not found"
      addBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }))
      return "clicked: " + addBtn.getAttribute('data-action')
    })()`,
    returnByValue: true,
  })
  console.log(clickResult.result?.result?.value)

  await new Promise((resolve) => setTimeout(resolve, 3000))

  // Check if a dialog appeared
  const dialogResult = await send("Runtime.evaluate", {
    expression: `(function() {
      // Check for dialog/modal elements
      const dialogs = document.querySelectorAll('[role="dialog"], [data-slot="dialog-content"], [data-slot="dialog-overlay"], [data-slot="dialog"]')
      const dialogInfo = []
      for (const d of dialogs) {
        const rect = d.getBoundingClientRect()
        if (rect.width > 10) {
          dialogInfo.push({
            tag: d.tagName,
            role: d.getAttribute('role'),
            slot: d.getAttribute('data-slot'),
            class: (typeof d.className === 'string' ? d.className : '').substring(0, 100),
            text: (d.textContent || '').trim().substring(0, 200),
            w: Math.round(rect.width), h: Math.round(rect.height),
          })
        }
      }
      // Also check for any overlay elements
      const overlays = document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="modal"]')
      const overlayInfo = []
      for (const o of overlays) {
        const rect = o.getBoundingClientRect()
        if (rect.width > 100 && rect.height > 100) {
          overlayInfo.push({ tag: o.tagName, class: (typeof o.className === 'string' ? o.className : '').substring(0, 80), w: Math.round(rect.width), h: Math.round(rect.height) })
        }
      }
      return JSON.stringify({ dialogs: dialogInfo, overlays: overlayInfo }, null, 2)
    })()`,
    returnByValue: true,
  })

  console.log("\n=== Dialog/overlay state after Add Project click ===")
  console.log(dialogResult.result?.result?.value)

  await new Promise((resolve) => setTimeout(resolve, 1000))
  console.log("\n=== Console ===")
  console.log(consoleMsgs.length > 0 ? consoleMsgs.join('\n') : '(none)')

  ws.close()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
