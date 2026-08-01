import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { createQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/solid-query"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import { createSizing } from "../helpers"
import { GitGraph } from "./git-graph"
import { type GraphCommit } from "./git-graph-layout"
import "./git-graph.css"

export type GitGraphPanelProps = {
  directory: string
}

type CommitFileDiff = {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status?: "added" | "deleted" | "modified"
}

const COMMIT_LIMIT = 200
const DEFAULT_HEIGHT = 220
const MIN_HEIGHT = 80
const MAX_HEIGHT = 600
const COLLAPSE_THRESHOLD = 60
const STORAGE_KEY = "git-graph-panel-height"
const COLLAPSED_HEIGHT = 32

function loadHeight(): number {
  if (typeof window === "undefined") return DEFAULT_HEIGHT
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === null) return DEFAULT_HEIGHT
  const parsed = Number.parseInt(stored, 10)
  if (Number.isNaN(parsed)) return DEFAULT_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parsed))
}

export function GitGraphPanel(props: GitGraphPanelProps): JSX.Element {
  const language = useLanguage()
  const sdk = useSDK()
  const file = useFile()
  const dialog = useDialog()
  const queryClient = useQueryClient()
  const size = createSizing()

  const [collapsed, setCollapsed] = createSignal(false)
  const [height, setHeight] = createSignal(loadHeight())
  const [selectedBranch, setSelectedBranch] = createSignal<string | undefined>()
  const [selectedHash, setSelectedHash] = createSignal<string | undefined>()

  const branchesQuery = createQuery(() => ({
    queryKey: ["git-graph-branches", props.directory] as const,
    queryFn: async () => {
      const result = await sdk().client.vcs.branches({ directory: props.directory })
      return (result.data ?? []) as readonly { name: string; current: boolean; kind: "local" | "remote" }[]
    },
  }))

  const localBranches = createMemo(() => (branchesQuery.data ?? []).filter((b) => b.kind === "local"))
  const currentBranch = createMemo(() => branchesQuery.data?.find((b) => b.current)?.name)
  const activeBranch = createMemo(() => selectedBranch() ?? currentBranch())

  createEffect(() => {
    const current = currentBranch()
    if (current && selectedBranch() === current) setSelectedBranch(undefined)
  })

  // 切换分支时清空选中提交,避免选中提交不在新分支历史中残留
  createEffect(() => {
    activeBranch()
    setSelectedHash(undefined)
  })

  const logQuery = createQuery(() => ({
    queryKey: ["git-graph-log", props.directory, activeBranch()] as const,
    // 切换分支时 queryKey 变化会触发新查询;保留旧数据作为占位,避免图形闪成 loading
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const result = await sdk().client.vcs.log({
        directory: props.directory,
        limit: String(COMMIT_LIMIT),
        branch: activeBranch(),
      })
      return (result.data ?? []) as readonly GraphCommit[]
    },
  }))

  const diffQuery = createQuery(() => ({
    queryKey: ["git-graph-commit-diff", props.directory, selectedHash()] as const,
    enabled: !!selectedHash(),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const hash = selectedHash()
      if (!hash) return [] as readonly CommitFileDiff[]
      const result = await sdk().client.vcs.commitDiff({ hash, directory: props.directory })
      return (result.data ?? []) as readonly CommitFileDiff[]
    },
  }))

  const checkoutMutation = useMutation(() => ({
    mutationFn: async (input: { branch: string; force: boolean }) => {
      await sdk().client.vcs.checkout({
        directory: props.directory,
        branch: input.branch,
        force: input.force,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["git-graph-branches", props.directory] })
      void queryClient.invalidateQueries({ queryKey: ["git-graph-log", props.directory] })
    },
  }))

  const onCheckout = (branch: string) => {
    if (branch === currentBranch()) return
    checkoutMutation.mutate(
      { branch, force: false },
      {
        onError: (error: unknown) => {
          const detail = extractCheckoutError(error)
          if (detail.reason !== "dirty") {
            showToast({
              variant: "error",
              title: language.t("session.gitGraph.checkoutError"),
              description: detail.message,
            })
            return
          }
          dialog.show(() => (
            <DirtyWorkspaceDialog
              branch={branch}
              onCancel={() => dialog.close()}
              onConfirm={() => {
                dialog.close()
                checkoutMutation.mutate(
                  { branch, force: true },
                  {
                    onError: (error: unknown) => {
                      const detail = extractCheckoutError(error)
                      showToast({
                        variant: "error",
                        title: language.t("session.gitGraph.checkoutError"),
                        description: detail.message,
                      })
                    },
                    onSuccess: () => {
                      setSelectedBranch(branch)
                      file.tree.refreshAll()
                      showToast({ variant: "success", title: language.t("session.gitGraph.branchSwitched") })
                    },
                  },
                )
              }}
            />
          ))
        },
        onSuccess: () => {
          setSelectedBranch(branch)
          file.tree.refreshAll()
          showToast({ variant: "success", title: language.t("session.gitGraph.branchSwitched") })
        },
      },
    )
  }

  const commits = createMemo(() => logQuery.data ?? [])
  const selectedCommit = createMemo(() => commits().find((c) => c.hash === selectedHash()))

  const onSelectHash = (hash: string) => {
    setSelectedHash((prev) => (prev === hash ? undefined : hash))
  }

  const onResize = (next: number) => {
    size.touch()
    setHeight(next)
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, String(next))
  }

  const panelHeight = () => (collapsed() ? COLLAPSED_HEIGHT : height())

  return (
    <div
      class="git-graph-panel"
      data-collapsed={collapsed()}
      data-sizing={size.active() ? "" : undefined}
      style={{ height: `${panelHeight()}px` }}
    >
      <Show when={!collapsed()}>
        <div class="git-graph-resize-handle" onPointerDown={() => size.start()}>
          <ResizeHandle
            direction="vertical"
            edge="start"
            size={height()}
            min={MIN_HEIGHT}
            max={MAX_HEIGHT}
            collapseThreshold={COLLAPSE_THRESHOLD}
            onResize={onResize}
            onCollapse={() => setCollapsed(true)}
          />
        </div>
      </Show>
      <div class="git-graph-header" onClick={() => setCollapsed((c) => !c)}>
        <span class="text-12-medium text-v2-text-text flex-1">
          {language.t("session.gitGraph.title")}
        </span>
        <span class="text-11-regular text-v2-text-text-weak">
          {commits().length} {language.t("session.gitGraph.commits")}
        </span>
        <span class="text-v2-text-text-weak text-11-regular">
          {collapsed() ? language.t("session.gitGraph.expand") : language.t("session.gitGraph.collapse")}
        </span>
      </div>
      <Show when={!collapsed()}>
        <div class="git-graph-body">
          <Show when={!branchesQuery.isLoading && localBranches().length > 0}>
            <div class="git-graph-branch-bar">
              <Popover
                class="git-graph-branch-popover"
                trigger={
                  <button
                    class="git-graph-branch-trigger"
                    disabled={checkoutMutation.isPending}
                  >
                    <Icon name="branch" class="git-graph-branch-icon" />
                    <span class="git-graph-branch-name">{activeBranch() ?? "—"}</span>
                    <Icon name="chevron-down" class="git-graph-branch-chevron" />
                  </button>
                }
              >
                <div class="git-graph-branch-list">
                  <For each={localBranches()}>
                    {(branch) => (
                      <button
                        class="git-graph-branch-item"
                        data-current={branch.current ? "" : undefined}
                        onClick={() => onCheckout(branch.name)}
                      >
                        <span class="git-graph-branch-item-name">{branch.name}</span>
                        <Show when={branch.current}>
                          <Icon name="check" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Popover>
            </div>
          </Show>
          <Show
            when={!logQuery.isLoading && !logQuery.isError}
            fallback={
              <Show
                when={!logQuery.isError}
                fallback={<div class="git-graph-loading">{language.t("session.gitGraph.checkoutError")}</div>}
              >
                <div class="git-graph-loading">{language.t("session.gitGraph.loading")}</div>
              </Show>
            }
          >
            <Show
              when={commits().length > 0}
              fallback={<div class="git-graph-loading">{language.t("session.gitGraph.empty")}</div>}
            >
              <GitGraph commits={commits()} selectedHash={selectedHash()} onSelect={onSelectHash} />
            </Show>
          </Show>
          <Show when={selectedCommit()} keyed>
            {(commit) => (
              <CommitDetail
                hash={commit.hash}
                message={commit.message}
                author={commit.author}
                date={commit.date}
                refs={commit.refs}
                diffData={diffQuery.data}
                diffLoading={diffQuery.isLoading}
                language={language}
                onClose={() => setSelectedHash(undefined)}
              />
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function CommitDetail(props: {
  hash: string
  message: string
  author: string
  date: string
  refs: readonly string[]
  diffData: readonly CommitFileDiff[] | undefined
  diffLoading: boolean
  language: ReturnType<typeof useLanguage>
  onClose: () => void
}) {
  const subject = createMemo(() => props.message.split("\n")[0] ?? "")

  return (
    <div class="git-graph-commit-detail">
      <div class="git-graph-commit-meta">
        <span class="git-graph-commit-hash">{props.hash.slice(0, 7)}</span>
        <span class="git-graph-commit-author">{props.author}</span>
        <span class="git-graph-commit-date">{formatDate(props.date)}</span>
        <button class="git-graph-commit-close" onClick={props.onClose} aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
          </svg>
        </button>
      </div>
      <div class="git-graph-commit-subject">{subject()}</div>
      <Show
        when={!props.diffLoading}
        fallback={<div class="git-graph-commit-detail-empty">{props.language.t("session.gitGraph.commit.loading")}</div>}
      >
        <Show
          when={(props.diffData?.length ?? 0) > 0}
          fallback={<div class="git-graph-commit-detail-empty">{props.language.t("session.gitGraph.commit.noChanges")}</div>}
        >
          <For each={props.diffData ?? []}>
            {(file) => (
              <div class="git-graph-file-item">
                <span class="git-graph-file-status" data-status={file.status ?? "modified"}>
                  {fileStatusLetter(file.status)}
                </span>
                <span class="git-graph-file-name">{file.file}</span>
                <span class="git-graph-file-additions">+{file.additions}</span>
                <span class="git-graph-file-deletions">-{file.deletions}</span>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}

function DirtyWorkspaceDialog(props: { branch: string; onCancel: () => void; onConfirm: () => void }) {
  const language = useLanguage()
  return (
    <Dialog title={language.t("session.gitGraph.dirty.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <p class="text-13-regular text-v2-text-text-weak">
          {language.t("session.gitGraph.dirty.description")}
        </p>
        <div class="flex justify-end gap-2">
          <ButtonV2 variant="neutral" size="normal" onClick={props.onCancel}>
            {language.t("session.gitGraph.dirty.cancel")}
          </ButtonV2>
          <ButtonV2 variant="danger" size="normal" onClick={props.onConfirm}>
            {language.t("session.gitGraph.dirty.confirm")}
          </ButtonV2>
        </div>
      </div>
    </Dialog>
  )
}

function extractCheckoutError(error: unknown): { reason?: string; message?: string } {
  if (!(error instanceof Error)) return {}
  const data = (error as { cause?: { body?: { data?: { reason?: string; message?: string } } } }).cause?.body?.data
  return { reason: data?.reason, message: data?.message }
}

function fileStatusLetter(status: "added" | "deleted" | "modified" | undefined): string {
  switch (status) {
    case "added":
      return "A"
    case "deleted":
      return "D"
    case "modified":
      return "M"
    default:
      return "M"
  }
}

function formatDate(date: string): string {
  const parsed = new Date(date)
  if (isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}
