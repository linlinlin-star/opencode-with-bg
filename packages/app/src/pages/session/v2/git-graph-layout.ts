// Pure git graph layout: assigns each commit to a horizontal lane and produces
// edges between commits and their parents. Processed newest-to-oldest so the
// graph reads top-down like `git log --graph`.
//
// Constants and colour palette mirror VSCode Git Graph (mhutchie/vscode-git-graph):
//   grid.x = 16, grid.y = 24, offsetX = 16, offsetY = 12

export type GraphCommit = {
  readonly hash: string
  readonly parents: readonly string[]
  readonly refs: readonly string[]
  readonly message: string
  readonly author: string
  readonly date: string
}

export type GraphNode = {
  readonly commit: GraphCommit
  readonly lane: number
  readonly index: number
}

export type GraphEdge = {
  readonly fromIndex: number
  readonly toIndex: number
  readonly fromLane: number
  readonly toLane: number
  readonly merge: boolean
}

export type GraphLayout = {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly laneCount: number
}

export const GRAPH_ROW_HEIGHT = 24
export const GRAPH_LANE_WIDTH = 16
export const GRAPH_LEFT_PADDING = 16
export const GRAPH_TOP_PADDING = 12

// VSCode Git Graph default 12-colour palette.
export const GRAPH_LANE_COLORS = [
  "#0085d9",
  "#d9008f",
  "#00d9a0",
  "#d98500",
  "#a300d9",
  "#ff0000",
  "#00d9cc",
  "#e138e8",
  "#85d900",
  "#dc5b23",
  "#6f24d6",
  "#ffcc00",
]

export function laneColor(lane: number): string {
  return GRAPH_LANE_COLORS[lane % GRAPH_LANE_COLORS.length]!
}

// Two-pass layout.
//
// Pass 1 — lane assignment: walk commits newest-to-oldest. Each lane slot
// holds the hash of the next commit expected in that lane. A commit claims
// the first lane that expects it (or a fresh free lane), then the lane is
// updated to expect the commit's first parent. Additional parents (merges)
// claim their own lanes so merge branches run in parallel columns.
//
// Pass 2 — edge construction: for each commit and each parent present in the
// history, emit an edge from the commit's lane to the parent's lane.
export function layoutGraph(commits: readonly GraphCommit[]): GraphLayout {
  if (commits.length === 0) return { nodes: [], edges: [], laneCount: 0 }

  const knownHashes = new Set(commits.map((c) => c.hash))
  const hashToIndex = new Map<string, number>()
  const laneOf = new Map<string, number>()

  const lanes: (string | undefined)[] = []

  const findFreeLane = () => {
    const free = lanes.indexOf(undefined)
    if (free !== -1) return free
    lanes.push(undefined)
    return lanes.length - 1
  }

  const nodes: GraphNode[] = []

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]!
    hashToIndex.set(commit.hash, i)

    let lane = -1
    for (let l = 0; l < lanes.length; l++) {
      if (lanes[l] === commit.hash) {
        lane = l
        for (let m = l + 1; m < lanes.length; m++) {
          if (lanes[m] === commit.hash) lanes[m] = undefined
        }
        break
      }
    }
    if (lane === -1) lane = findFreeLane()

    laneOf.set(commit.hash, lane)
    nodes.push({ commit, lane, index: i })

    const firstParent = commit.parents[0]
    lanes[lane] = firstParent && knownHashes.has(firstParent) ? firstParent : undefined

    for (let p = 1; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p]!
      if (!knownHashes.has(parentHash)) continue
      if (!lanes.includes(parentHash)) {
        const parentLane = findFreeLane()
        lanes[parentLane] = parentHash
      }
    }
  }

  const edges: GraphEdge[] = []
  for (const node of nodes) {
    for (let p = 0; p < node.commit.parents.length; p++) {
      const parentHash = node.commit.parents[p]!
      const parentIndex = hashToIndex.get(parentHash)
      if (parentIndex === undefined) continue
      edges.push({
        fromIndex: node.index,
        toIndex: parentIndex,
        fromLane: node.lane,
        toLane: laneOf.get(parentHash)!,
        merge: p > 0,
      })
    }
  }

  return { nodes, edges, laneCount: lanes.length }
}

export type ParsedRefs = {
  readonly head: boolean
  readonly branches: readonly string[]
  readonly tags: readonly string[]
  readonly remoteBranches: readonly string[]
}

export function parseRefs(refs: readonly string[]): ParsedRefs {
  let head = false
  const branches: string[] = []
  const tags: string[] = []
  const remoteBranches: string[] = []

  for (const ref of refs) {
    for (const part of ref.split(",")) {
      const trimmed = part.trim()
      if (trimmed === "HEAD") {
        head = true
        continue
      }
      if (trimmed.startsWith("HEAD -> ")) {
        head = true
        branches.push(trimmed.slice("HEAD -> ".length))
        continue
      }
      if (trimmed.startsWith("tag: ")) {
        tags.push(trimmed.slice("tag: ".length))
        continue
      }
      if (trimmed.includes("/")) {
        remoteBranches.push(trimmed)
      } else {
        branches.push(trimmed)
      }
    }
  }

  return { head, branches, tags, remoteBranches }
}
