import { createEffect, createMemo, onCleanup, onMount, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import {
  GRAPH_LANE_WIDTH,
  GRAPH_LEFT_PADDING,
  GRAPH_ROW_HEIGHT,
  GRAPH_TOP_PADDING,
  laneColor,
  layoutGraph,
  parseRefs,
  type GraphCommit,
} from "./git-graph-layout"

export type GitGraphProps = {
  commits: readonly GraphCommit[]
  selectedHash: string | undefined
  onSelect: (hash: string) => void
}

// VSCode Git Graph rendering constants.
const NODE_RADIUS = 4
const EDGE_WIDTH = 2
const SHADOW_WIDTH = 4
const SHADOW_OPACITY = 0.75
const CURVE_OFFSET = GRAPH_ROW_HEIGHT * 0.8 // 19.2 — matches Git Graph "Rounded" style
const MESSAGE_LEFT_PADDING = 3
const REF_HEIGHT = 18
const REF_RADIUS = 5
const REF_GAP = 5
const REF_PADDING_X = 5
const REF_ICON_SIZE = 14
const REF_MAX_WIDTH = 120

type RefTag = { label: string; color: string; active: boolean }

export function GitGraph(props: GitGraphProps): JSX.Element {
  const language = useLanguage()
  let canvasRef: HTMLCanvasElement | undefined
  let scrollRef: HTMLDivElement | undefined

  const layout = createMemo(() => layoutGraph(props.commits))

  const contentWidth = createMemo(() => {
    const lanes = layout().laneCount
    return GRAPH_LEFT_PADDING + Math.max(lanes, 1) * GRAPH_LANE_WIDTH + 280
  })
  const contentHeight = createMemo(() =>
    Math.max(props.commits.length * GRAPH_ROW_HEIGHT + GRAPH_TOP_PADDING, 1),
  )

  const findCommitAt = (clientX: number, clientY: number): string | undefined => {
    const canvas = canvasRef
    const scroll = scrollRef
    if (!canvas || !scroll) return
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top + scroll.scrollTop
    const nodes = layout().nodes
    for (const node of nodes) {
      const nodeX = GRAPH_LEFT_PADDING + node.lane * GRAPH_LANE_WIDTH
      const nodeY = node.index * GRAPH_ROW_HEIGHT + GRAPH_TOP_PADDING
      const dx = x - nodeX
      const dy = y - nodeY
      if (dx * dx + dy * dy <= (NODE_RADIUS + 8) ** 2) return node.commit.hash
    }
    const rowIndex = Math.floor((y - GRAPH_TOP_PADDING) / GRAPH_ROW_HEIGHT)
    if (rowIndex >= 0 && rowIndex < nodes.length) return nodes[rowIndex]!.commit.hash
    return undefined
  }

  const onClick = (event: MouseEvent) => {
    const hash = findCommitAt(event.clientX, event.clientY)
    if (hash) props.onSelect(hash)
  }

  const draw = () => {
    const canvas = canvasRef
    const scroll = scrollRef
    if (!canvas || !scroll) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const visibleWidth = scroll.clientWidth
    const visibleHeight = scroll.clientHeight
    const scrollTop = scroll.scrollTop

    canvas.width = Math.floor(visibleWidth * dpr)
    canvas.height = Math.floor(visibleHeight * dpr)
    canvas.style.width = `${visibleWidth}px`
    canvas.style.height = `${visibleHeight}px`

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, visibleWidth, visibleHeight)
    // Canvas is position:sticky — translate so content Y maps to viewport Y.
    ctx.translate(0, -scrollTop)

    const theme = resolveTheme()
    const { nodes, edges, laneCount } = layout()
    if (nodes.length === 0) {
      ctx.fillStyle = theme.textWeak
      ctx.font = "12px Inter, system-ui, sans-serif"
      ctx.textBaseline = "middle"
      ctx.fillText(language.t("session.gitGraph.empty"), GRAPH_LEFT_PADDING, GRAPH_TOP_PADDING)
      return
    }

    const laneX = (lane: number) => GRAPH_LEFT_PADDING + lane * GRAPH_LANE_WIDTH
    const rowY = (index: number) => index * GRAPH_ROW_HEIGHT + GRAPH_TOP_PADDING

    const firstVisible = Math.max(0, Math.floor((scrollTop - GRAPH_TOP_PADDING) / GRAPH_ROW_HEIGHT) - 1)
    const lastVisible = Math.min(
      nodes.length - 1,
      Math.ceil((scrollTop + visibleHeight - GRAPH_TOP_PADDING) / GRAPH_ROW_HEIGHT) + 1,
    )

    ctx.font = "12px Inter, system-ui, sans-serif"
    ctx.textBaseline = "middle"

    const visibleEdges = edges.filter((e) => {
      if (e.fromIndex < firstVisible && e.toIndex < firstVisible) return false
      if (e.fromIndex > lastVisible && e.toIndex > lastVisible) return false
      return true
    })

    // --- Pass 1: edge shadows (width 4, bg colour) — create halos so crossings look clean ---
    ctx.lineWidth = SHADOW_WIDTH
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = theme.bg
    ctx.globalAlpha = SHADOW_OPACITY
    for (const edge of visibleEdges) {
      const fromX = laneX(edge.fromLane)
      const fromY = rowY(edge.fromIndex)
      const toX = laneX(edge.toLane)
      const toY = rowY(edge.toIndex)
      ctx.beginPath()
      if (edge.fromLane === edge.toLane) {
        ctx.moveTo(fromX, fromY)
        ctx.lineTo(toX, toY)
      } else {
        ctx.moveTo(fromX, fromY)
        ctx.bezierCurveTo(fromX, fromY + CURVE_OFFSET, toX, toY - CURVE_OFFSET, toX, toY)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // --- Pass 2: edge lines (width 2, lane colour) ---
    ctx.lineWidth = EDGE_WIDTH
    for (const edge of visibleEdges) {
      const fromX = laneX(edge.fromLane)
      const fromY = rowY(edge.fromIndex)
      const toX = laneX(edge.toLane)
      const toY = rowY(edge.toIndex)
      ctx.strokeStyle = edge.merge ? laneColor(edge.fromLane) : laneColor(edge.toLane)
      ctx.beginPath()
      if (edge.fromLane === edge.toLane) {
        ctx.moveTo(fromX, fromY)
        ctx.lineTo(toX, toY)
      } else {
        ctx.moveTo(fromX, fromY)
        ctx.bezierCurveTo(fromX, fromY + CURVE_OFFSET, toX, toY - CURVE_OFFSET, toX, toY)
      }
      ctx.stroke()
    }

    // --- Pass 3: nodes ---
    for (let i = firstVisible; i <= lastVisible; i++) {
      const node = nodes[i]
      if (!node) continue
      const x = laneX(node.lane)
      const y = rowY(node.index)
      const refs = parseRefs(node.commit.refs)
      const isSelected = node.commit.hash === props.selectedHash
      const color = laneColor(node.lane)

      // Selection halo.
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(x, y, NODE_RADIUS + 4, 0, Math.PI * 2)
        ctx.fillStyle = withAlpha(theme.head, 0.2)
        ctx.fill()
      }

      if (refs.head) {
        // HEAD: hollow circle (fill=bg, stroke=branch colour, width 2).
        ctx.beginPath()
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = theme.bg
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.stroke()
      } else {
        // Regular: filled circle (lane colour) with bg stroke (width 1, 0.75).
        ctx.beginPath()
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = theme.bg
        ctx.lineWidth = 1
        ctx.globalAlpha = SHADOW_OPACITY
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    // --- Pass 4: commit messages + ref labels ---
    // Per-commit anchor: each message hugs its own node based on the node's lane,
    // so the text starts just past the node regardless of which column it's in.
    // The tree (lanes, nodes, edges) is unaffected.
    const rightEdge = visibleWidth - 4

    // For each row, find the rightmost lane that holds the commit's own node
    // OR an edge that passes through that row. The message must start past this
    // so it never paints over a node or an edge in another lane.
    const rightmostLaneInRow = (rowIndex: number, ownLane: number): number => {
      let rightmost = ownLane
      for (const edge of edges) {
        if (edge.fromIndex < rowIndex && edge.toIndex > rowIndex) {
          const lane = edge.fromLane > edge.toLane ? edge.fromLane : edge.toLane
          if (lane > rightmost) rightmost = lane
        }
      }
      return rightmost
    }

    for (let i = firstVisible; i <= lastVisible; i++) {
      const node = nodes[i]
      if (!node) continue
      const y = rowY(node.index)
      const refs = parseRefs(node.commit.refs)
      const color = laneColor(node.lane)

      const rightmost = rightmostLaneInRow(node.index, node.lane)
      // Hug the rightmost occupied lane in the row so the text never paints
      // over a node or edge in another lane. The tree display is preserved.
      let msgX =
        GRAPH_LEFT_PADDING +
        rightmost * GRAPH_LANE_WIDTH +
        NODE_RADIUS +
        MESSAGE_LEFT_PADDING

      // Floor for the commit's own lane — never start the text to the LEFT
      // of the node it belongs to, otherwise we'd cover the tree.
      const ownMsgX =
        GRAPH_LEFT_PADDING +
        node.lane * GRAPH_LANE_WIDTH +
        NODE_RADIUS +
        MESSAGE_LEFT_PADDING

      const refTags = buildRefTags(refs, color, theme)

      // Lay out ref tags right-to-left (Git Graph style).
      let cursorX = rightEdge
      const laidOut: { tag: RefTag; x: number; width: number; label: string }[] = []
      for (let t = refTags.length - 1; t >= 0; t--) {
        const tag = refTags[t]!
        const label = truncate(ctx, tag.label, REF_MAX_WIDTH - REF_ICON_SIZE - REF_PADDING_X * 2)
        const textW = ctx.measureText(label).width
        const tagW = REF_ICON_SIZE + textW + REF_PADDING_X * 2
        if (cursorX - tagW < msgX) break
        cursorX -= tagW + REF_GAP
        laidOut.unshift({ tag, x: cursorX, width: tagW, label })
      }

      const usedRight = laidOut.length > 0 ? rightEdge - cursorX + REF_GAP : 0
      const subject = node.commit.message.split("\n")[0] ?? ""
      // Ensure the message is always at least a few characters wide. If the
      // ref tags crowd the row, pull msgX left — but never past the commit's
      // own node — so the text is never painted as an empty string.
      const MIN_SUBJECT_WIDTH = 32
      let availableForSubject = Math.max(0, rightEdge - msgX - usedRight)
      if (availableForSubject < MIN_SUBJECT_WIDTH) {
        const targetMsgX = rightEdge - usedRight - MIN_SUBJECT_WIDTH
        msgX = Math.max(ownMsgX, targetMsgX)
        availableForSubject = Math.max(0, rightEdge - msgX - usedRight)
      }
      const maxSubjectW = availableForSubject
      ctx.fillStyle = theme.text
      ctx.fillText(truncate(ctx, subject, maxSubjectW), msgX, y)

      // Draw ref labels: grey translucent pill + coloured icon box + text.
      for (const item of laidOut) {
        const { tag, x, width, label } = item
        const tagY = y - REF_HEIGHT / 2

        // Pill background (translucent grey).
        ctx.beginPath()
        roundRect(ctx, x, tagY, width, REF_HEIGHT, REF_RADIUS)
        ctx.fillStyle = "rgba(128,128,128,0.15)"
        ctx.fill()

        // Coloured icon box on the left, clipped to the pill shape.
        ctx.save()
        ctx.beginPath()
        roundRect(ctx, x, tagY, width, REF_HEIGHT, REF_RADIUS)
        ctx.clip()
        ctx.fillStyle = tag.color
        ctx.fillRect(x, tagY, REF_ICON_SIZE, REF_HEIGHT)
        ctx.restore()

        // Pill border (grey, or branch colour if active).
        ctx.beginPath()
        roundRect(ctx, x, tagY, width, REF_HEIGHT, REF_RADIUS)
        ctx.strokeStyle = tag.active ? tag.color : "rgba(128,128,128,0.75)"
        ctx.lineWidth = 1
        ctx.stroke()

        // Label text.
        ctx.fillStyle = theme.text
        ctx.fillText(label, x + REF_ICON_SIZE + REF_PADDING_X, y)
      }
    }
  }

  let rafId = 0
  const scheduleDraw = () => {
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      draw()
    })
  }

  onMount(() => {
    const scroll = scrollRef
    if (!scroll) return
    const onScroll = () => scheduleDraw()
    scroll.addEventListener("scroll", onScroll, { passive: true })
    const resizeObserver = new ResizeObserver(() => scheduleDraw())
    resizeObserver.observe(scroll)
    scheduleDraw()
    onCleanup(() => {
      scroll.removeEventListener("scroll", onScroll)
      resizeObserver.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
    })
  })

  createEffect(() => {
    void props.commits.length
    void props.selectedHash
    scheduleDraw()
  })

  return (
    <div ref={scrollRef} class="git-graph-scroll" onClick={onClick}>
      <div class="git-graph-content" style={{ width: `${contentWidth()}px`, height: `${contentHeight()}px` }}>
        <canvas ref={canvasRef} class="git-graph-canvas" />
      </div>
    </div>
  )
}

function buildRefTags(
  refs: ReturnType<typeof parseRefs>,
  laneColorHex: string,
  theme: ReturnType<typeof resolveTheme>,
): RefTag[] {
  const tags: RefTag[] = []
  if (refs.head) tags.push({ label: "HEAD", color: theme.head, active: true })
  for (const b of refs.branches) tags.push({ label: b, color: laneColorHex, active: refs.head })
  for (const t of refs.tags) tags.push({ label: t, color: "#8b949e", active: false })
  for (const r of refs.remoteBranches) tags.push({ label: r, color: theme.remote, active: false })
  return tags
}

function resolveTheme() {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback
  return {
    text: token("--v2-text-text-base", "#e5e7eb"),
    textWeak: token("--v2-text-text-muted", "#9ca3af"),
    head: token("--v2-text-text-accent", "#60a5fa"),
    bg: token("--v2-background-bg-base", "#1e1e1e"),
    remote: "#8b949e",
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = "…"
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid + 1
    else hi = mid
  }
  return text.slice(0, Math.max(0, lo - 1)) + ellipsis
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.startsWith("#") ? color.slice(1) : ""
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  return `rgba(0,0,0,${alpha})`
}
