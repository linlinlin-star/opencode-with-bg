import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect, Layer, Context, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"

const cfg = [
  "--no-optional-locks",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const

const out = (result: { text(): string }) => result.text().trim()
const nuls = (text: string) => text.split("\0").filter(Boolean)
const fail = (err: unknown) =>
  ({
    exitCode: 1,
    text: () => "",
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
    truncated: false,
  }) satisfies Result

export type Kind = "added" | "deleted" | "modified"

export type Base = {
  readonly name: string
  readonly ref: string
}

export type Item = {
  readonly file: string
  readonly code: string
  readonly status: Kind
}

export type Stat = {
  readonly file: string
  readonly additions: number
  readonly deletions: number
}

export type Patch = {
  readonly text: string
  readonly truncated: boolean
}

export interface PatchOptions {
  readonly context?: number
  readonly maxOutputBytes?: number
}

export type Branch = {
  readonly name: string
  readonly current: boolean
  readonly kind: "local" | "remote"
  readonly upstream?: string
}

export type Commit = {
  readonly hash: string
  readonly parents: readonly string[]
  readonly refs: readonly string[]
  readonly message: string
  readonly author: string
  readonly email: string
  readonly date: string
}

export type CommitFileStat = {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status: Kind
}

export interface LogOptions {
  readonly limit?: number
  readonly branch?: string
  readonly all?: boolean
}

export interface CheckoutOptions {
  readonly force?: boolean
}

export type CheckoutResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "dirty" | "not-found" | "error"; readonly message: string }

export interface Result {
  readonly exitCode: number
  readonly text: () => string
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly truncated: boolean
}

export interface Options {
  readonly cwd: string
  readonly env?: Record<string, string>
  readonly maxOutputBytes?: number
  readonly stdin?: ChildProcess.CommandInput
}

export interface Interface {
  readonly run: (args: string[], opts: Options) => Effect.Effect<Result>
  readonly branch: (cwd: string) => Effect.Effect<string | undefined>
  readonly prefix: (cwd: string) => Effect.Effect<string>
  readonly defaultBranch: (cwd: string) => Effect.Effect<Base | undefined>
  readonly hasHead: (cwd: string) => Effect.Effect<boolean>
  readonly mergeBase: (cwd: string, base: string, head?: string) => Effect.Effect<string | undefined>
  readonly show: (cwd: string, ref: string, file: string, prefix?: string) => Effect.Effect<string>
  readonly status: (cwd: string) => Effect.Effect<Item[]>
  readonly diff: (cwd: string, ref: string) => Effect.Effect<Item[]>
  readonly stats: (cwd: string, ref: string) => Effect.Effect<Stat[]>
  readonly patch: (cwd: string, ref: string, file: string, options?: PatchOptions) => Effect.Effect<Patch>
  readonly patchAll: (cwd: string, ref: string, options?: PatchOptions) => Effect.Effect<Patch>
  readonly patchUntracked: (cwd: string, file: string, options?: PatchOptions) => Effect.Effect<Patch>
  readonly statUntracked: (cwd: string, file: string) => Effect.Effect<Stat | undefined>
  readonly applyPatch: (cwd: string, patch: string) => Effect.Effect<Result>
  readonly branchList: (cwd: string) => Effect.Effect<Branch[]>
  readonly log: (cwd: string, options?: LogOptions) => Effect.Effect<Commit[]>
  readonly checkout: (cwd: string, branch: string, options?: CheckoutOptions) => Effect.Effect<CheckoutResult>
  readonly commitDiff: (cwd: string, hash: string) => Effect.Effect<CommitFileStat[]>
}

const kind = (code: string): Kind => {
  if (code === "??") return "added"
  if (code.includes("U")) return "modified"
  if (code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  return "modified"
}

// for-each-ref uses two-hex-digit byte escapes (%1f), NOT the %x1f syntax that
// git log --format understands. Using %x1f here emits the literal text "x1f"
// after the field, which is how branch names picked up trailing control noise.
const REF_SEP = "\x1f"

const parseBranches = (local: string[], remote: string[], current: string): Branch[] => {
  const out: Branch[] = []
  for (const line of local) {
    const [name, , upstream] = line.split(REF_SEP)
    if (!name) continue
    out.push({ name, current: name === current, kind: "local", upstream: upstream || undefined })
  }
  for (const line of remote) {
    const [name] = line.split(REF_SEP)
    if (!name || name.endsWith("/HEAD")) continue
    out.push({ name, current: false, kind: "remote" })
  }
  return out
}

const parseLog = (raw: string): Commit[] =>
  nuls(raw).map((record) => {
    const [hash, parents, author, email, date, message, refs] = record.split("\x1f")
    return {
      hash: hash ?? "",
      parents: (parents ?? "").split(" ").filter(Boolean),
      refs: (refs ?? "").split(", ").map((item) => item.trim()).filter(Boolean),
      message: message ?? "",
      author: author ?? "",
      email: email ?? "",
      date: date ?? "",
    } satisfies Commit
  })

export class Service extends Context.Service<Service, Interface>()("@opencode/Git") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const encoder = new TextEncoder()
    const stdin = (text: string) => Stream.make(encoder.encode(text))

    const run = Effect.fn("Git.run")(
      function* (args: string[], opts: Options) {
        const result = yield* appProcess.run(
          ChildProcess.make("git", [...cfg, ...args], {
            cwd: opts.cwd,
            env: { ...opts.env, LANGUAGE: "en", LC_ALL: "C" },
            extendEnv: true,
            stdin: opts.stdin ?? "ignore",
            stdout: "pipe",
            stderr: "pipe",
          }),
          { maxOutputBytes: opts.maxOutputBytes },
        )
        return {
          exitCode: result.exitCode,
          text: () => result.stdout.toString("utf8"),
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.stdoutTruncated || result.stderrTruncated,
        } satisfies Result
      },
      Effect.catch((err) => Effect.succeed(fail(err))),
    )

    const text = Effect.fn("Git.text")(function* (args: string[], opts: Options) {
      return (yield* run(args, opts)).text()
    })

    const lines = Effect.fn("Git.lines")(function* (args: string[], opts: Options) {
      return (yield* text(args, opts))
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    })

    const refs = Effect.fnUntraced(function* (cwd: string) {
      return yield* lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
    })

    const configured = Effect.fnUntraced(function* (cwd: string, list: string[]) {
      const result = yield* run(["config", "init.defaultBranch"], { cwd })
      const name = out(result)
      if (!name || !list.includes(name)) return
      return { name, ref: name } satisfies Base
    })

    const primary = Effect.fnUntraced(function* (cwd: string) {
      const list = yield* lines(["remote"], { cwd })
      if (list.includes("origin")) return "origin"
      if (list.length === 1) return list[0]
      if (list.includes("upstream")) return "upstream"
      return list[0]
    })

    const branch = Effect.fn("Git.branch")(function* (cwd: string) {
      const result = yield* run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd })
      if (result.exitCode !== 0) return
      const text = out(result)
      return text || undefined
    })

    const prefix = Effect.fn("Git.prefix")(function* (cwd: string) {
      const result = yield* run(["rev-parse", "--show-prefix"], { cwd })
      if (result.exitCode !== 0) return ""
      return out(result)
    })

    const defaultBranch = Effect.fn("Git.defaultBranch")(function* (cwd: string) {
      const remote = yield* primary(cwd)
      if (remote) {
        const head = yield* run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
        if (head.exitCode === 0) {
          const ref = out(head).replace(/^refs\/remotes\//, "")
          const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
          if (name) return { name, ref } satisfies Base
        }
      }

      const list = yield* refs(cwd)
      const next = yield* configured(cwd, list)
      if (next) return next
      if (list.includes("main")) return { name: "main", ref: "main" } satisfies Base
      if (list.includes("master")) return { name: "master", ref: "master" } satisfies Base
    })

    const hasHead = Effect.fn("Git.hasHead")(function* (cwd: string) {
      const result = yield* run(["rev-parse", "--verify", "HEAD"], { cwd })
      return result.exitCode === 0
    })

    const mergeBase = Effect.fn("Git.mergeBase")(function* (cwd: string, base: string, head = "HEAD") {
      const result = yield* run(["merge-base", base, head], { cwd })
      if (result.exitCode !== 0) return
      const text = out(result)
      return text || undefined
    })

    const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, file: string, prefix = "") {
      const target = prefix ? `${prefix}${file}` : file
      const result = yield* run(["show", `${ref}:${target}`], { cwd })
      if (result.exitCode !== 0) return ""
      if (result.stdout.includes(0)) return ""
      return result.text()
    })

    const status = Effect.fn("Git.status")(function* (cwd: string) {
      return nuls(
        yield* text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], {
          cwd,
        }),
      ).flatMap((item) => {
        const file = item.slice(3)
        if (!file) return []
        const code = item.slice(0, 2)
        return [{ file, code, status: kind(code) } satisfies Item]
      })
    })

    const diff = Effect.fn("Git.diff")(function* (cwd: string, ref: string) {
      const list = nuls(
        yield* text(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd }),
      )
      return list.flatMap((code, idx) => {
        if (idx % 2 !== 0) return []
        const file = list[idx + 1]
        if (!code || !file) return []
        return [{ file, code, status: kind(code) } satisfies Item]
      })
    })

    const stats = Effect.fn("Git.stats")(function* (cwd: string, ref: string) {
      return nuls(
        yield* text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }),
      ).flatMap((item) => {
        const a = item.indexOf("\t")
        const b = item.indexOf("\t", a + 1)
        if (a === -1 || b === -1) return []
        const file = item.slice(b + 1)
        if (!file) return []
        const adds = item.slice(0, a)
        const dels = item.slice(a + 1, b)
        const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10)
        const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10)
        return [
          {
            file,
            additions: Number.isFinite(additions) ? additions : 0,
            deletions: Number.isFinite(deletions) ? deletions : 0,
          } satisfies Stat,
        ]
      })
    })

    const patch = Effect.fn("Git.patch")(function* (cwd: string, ref: string, file: string, options?: PatchOptions) {
      const result = yield* run(
        ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${options?.context ?? 3}`, ref, "--", file],
        { cwd, maxOutputBytes: options?.maxOutputBytes },
      )
      return { text: result.truncated ? "" : result.text(), truncated: result.truncated } satisfies Patch
    })

    const patchAll = Effect.fn("Git.patchAll")(function* (cwd: string, ref: string, options?: PatchOptions) {
      const result = yield* run(
        ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${options?.context ?? 3}`, ref, "--", "."],
        { cwd, maxOutputBytes: options?.maxOutputBytes },
      )
      return { text: result.text(), truncated: result.truncated } satisfies Patch
    })

    const patchUntracked = Effect.fn("Git.patchUntracked")(function* (
      cwd: string,
      file: string,
      options?: PatchOptions,
    ) {
      const result = yield* run(
        [
          "diff",
          "--no-index",
          "--patch",
          "--no-ext-diff",
          "--no-renames",
          `--unified=${options?.context ?? 3}`,
          "--",
          "/dev/null",
          file,
        ],
        { cwd, maxOutputBytes: options?.maxOutputBytes },
      )
      return { text: result.truncated ? "" : result.text(), truncated: result.truncated } satisfies Patch
    })

    const statUntracked = Effect.fn("Git.statUntracked")(function* (cwd: string, file: string) {
      const result = yield* run(["diff", "--no-index", "--numstat", "--", "/dev/null", file], {
        cwd,
        maxOutputBytes: 4096,
      })

      if (result.truncated) return
      const text = result.text()

      const parts = text.split("\t")
      if (parts.length < 2) return

      const additions = parts[0] === "-" ? 0 : Number.parseInt(parts[0] || "0", 10)
      const deletions = parts[1] === "-" ? 0 : Number.parseInt(parts[1] || "0", 10)
      return {
        file,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      } satisfies Stat
    })

    const applyPatch = Effect.fn("Git.applyPatch")(function* (cwd: string, patch: string) {
      return yield* run(["apply", "-"], { cwd, stdin: stdin(patch) })
    })

    const branchList = Effect.fn("Git.branchList")(function* (cwd: string) {
      const current = out(yield* run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd }))
      // for-each-ref takes two-hex-digit byte escapes (%1f); %x1f is git-log syntax and would leak as literal text.
      const fmt = `%(refname:short)%1f%(refname)%1f%(upstream:short)`
      const [local, remote] = yield* Effect.all(
        [
          lines(["for-each-ref", `--format=${fmt}`, "refs/heads"], { cwd }),
          lines(["for-each-ref", `--format=${fmt}`, "refs/remotes"], { cwd }),
        ],
        { concurrency: 2 },
      )
      return parseBranches(local, remote, current)
    })

    const log = Effect.fn("Git.log")(function* (cwd: string, options?: LogOptions) {
      // Fields are %x1f-separated (git log syntax); -z separates records with NUL so subjects with newlines stay intact.
      const fmt = "%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D"
      // With a branch, default to that branch's history only so the graph follows the selection.
      // Without a branch, use --all to show every branch. all:true/false overrides either default.
      const useAll = options?.all ?? !options?.branch
      const raw = yield* text(
        [
          "log",
          `--format=${fmt}`,
          "-z",
          `--max-count=${options?.limit ?? 200}`,
          ...(options?.branch ? [options.branch] : []),
          ...(useAll ? ["--all"] : []),
        ],
        { cwd },
      )
      return parseLog(raw)
    })

    const checkout = Effect.fn("Git.checkout")(
      function* (cwd: string, branchName: string, options?: CheckoutOptions) {
        const result = yield* run(
          ["checkout", ...(options?.force ? ["-f"] : []), "--", branchName],
          { cwd },
        )
        if (result.exitCode === 0) return { ok: true } as const
        const stderr = result.stderr.toString("utf8")
        if (/local changes|would be overwritten|stash|need (your|to) commit/i.test(stderr)) {
          return { ok: false, reason: "dirty", message: stderr } as const
        }
        if (/pathspec|did not match|unknown revision|not a valid|ambiguous/i.test(stderr)) {
          return { ok: false, reason: "not-found", message: stderr } as const
        }
        return { ok: false, reason: "error", message: stderr } as const
      },
    )

    const commitDiff = Effect.fn("Git.commitDiff")(function* (cwd: string, hash: string) {
      // --root makes the initial commit show its files; diff-tree avoids the commit message section.
      const [numstat, nameStatus] = yield* Effect.all(
        [
          text(["diff-tree", "-r", "--root", "--numstat", "-z", "--no-commit-id", "--no-renames", hash], { cwd }),
          text(["diff-tree", "-r", "--root", "--name-status", "-z", "--no-commit-id", "--no-renames", hash], { cwd }),
        ],
        { concurrency: 2 },
      )
      const stats = new Map<string, { additions: number; deletions: number }>()
      for (const entry of nuls(numstat)) {
        const a = entry.indexOf("\t")
        const b = entry.indexOf("\t", a + 1)
        if (a === -1 || b === -1) continue
        const file = entry.slice(b + 1)
        if (!file) continue
        const adds = entry.slice(0, a)
        const dels = entry.slice(a + 1, b)
        stats.set(file, {
          additions: adds === "-" ? 0 : Number.parseInt(adds || "0", 10),
          deletions: dels === "-" ? 0 : Number.parseInt(dels || "0", 10),
        })
      }
      const statuses = nuls(nameStatus)
      const items: { file: string; code: string }[] = []
      for (let i = 0; i < statuses.length; i += 2) {
        const code = statuses[i]
        const file = statuses[i + 1]
        if (!code || !file) continue
        items.push({ file, code })
      }
      return items.map((item) => {
        const stat = stats.get(item.file)
        return {
          file: item.file,
          additions: stat?.additions ?? 0,
          deletions: stat?.deletions ?? 0,
          status: kind(item.code),
        } satisfies CommitFileStat
      })
    })

    return Service.of({
      run,
      branch,
      prefix,
      defaultBranch,
      hasHead,
      mergeBase,
      show,
      status,
      diff,
      stats,
      patch,
      patchAll,
      patchUntracked,
      statUntracked,
      applyPatch,
      branchList,
      log,
      checkout,
      commitDiff,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [AppProcess.node] })

export * as Git from "."
