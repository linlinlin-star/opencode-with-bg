import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/session-ui/file"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/session-ui/line-comment-annotations"
import { createLineCommentControllerV2 } from "@opencode-ai/session-ui/v2/line-comment-annotations-v2"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { LineCommentV2OverflowIcon } from "@opencode-ai/ui/v2/line-comment-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@/utils/toast"
import {
  selectionFromLines,
  useFile,
  type FileSelection,
  type MarkdownPreviewMode,
  type SelectedLineRange,
} from "@/context/file"
import { isMarkdownPath } from "@/context/file/path"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSettings } from "@/context/settings"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

type SessionFileViewProps = {
  tab: string
}

const selectionSide = (range: SelectedLineRange) => range.endSide ?? range.side ?? "additions"

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

function FileCommentMenuV2(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <MenuV2 gutter={4}>
        <MenuV2.Trigger as="button" type="button" data-slot="line-comment-v2-overflow" aria-label={props.moreLabel}>
          <LineCommentV2OverflowIcon />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.Item onSelect={props.onEdit}>{props.editLabel}</MenuV2.Item>
            <MenuV2.Item onSelect={props.onDelete}>{props.deleteLabel}</MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

// Proportional scroll sync between the source and preview panes of the split
// markdown view. A syncing flag breaks the feedback loop where syncing B's
// scrollTop fires A's scroll event, which would sync B again.
function createSplitScrollSync() {
  const [sourceEl, setSourceEl] = createSignal<HTMLDivElement>()
  const [previewEl, setPreviewEl] = createSignal<HTMLDivElement>()
  let syncing = false

  const sync = (from: HTMLDivElement, to: HTMLDivElement | undefined) => {
    if (!to || syncing) return
    const max = from.scrollHeight - from.clientHeight
    if (max <= 0) return
    const ratio = from.scrollTop / max
    const targetMax = to.scrollHeight - to.clientHeight
    const next = Math.round(ratio * targetMax)
    if (Math.abs(to.scrollTop - next) < 1) return
    syncing = true
    to.scrollTop = next
    requestAnimationFrame(() => {
      syncing = false
    })
  }

  createEffect(() => {
    const el = sourceEl()
    if (el) makeEventListener(el, "scroll", () => sync(el, previewEl()))
  })
  createEffect(() => {
    const el = previewEl()
    if (el) makeEventListener(el, "scroll", () => sync(el, sourceEl()))
  })

  return { setSource: setSourceEl, setPreview: setPreviewEl }
}

function Breadcrumb(props: { path: string; onCrumbClick: (dirPath: string) => void }) {
  const segments = createMemo(() => props.path.split(/[/\\]/).filter(Boolean))
  const crumbs = createMemo(() => {
    const result: { label: string; dirPath: string }[] = []
    let acc = ""
    for (const seg of segments()) {
      acc = acc ? `${acc}/${seg}` : seg
      result.push({ label: seg, dirPath: acc })
    }
    return result
  })
  return (
    <nav class="flex items-center gap-0.5 min-w-0 overflow-hidden text-12-regular text-text-muted">
      <For each={crumbs()}>
        {(item, index) => (
          <>
            <Show when={index() > 0}>
              <Icon name="chevron-right" class="size-3 shrink-0 opacity-50" />
            </Show>
            <button
              type="button"
              class="truncate px-1 py-0.5 rounded hover:bg-bg-layer-02 transition-colors"
              classList={{ "text-text-base font-medium": index() === segments().length - 1 }}
              onClick={() => index() < segments().length - 1 && props.onCrumbClick(item.dirPath)}
            >
              {item.label}
            </button>
          </>
        )}
      </For>
    </nav>
  )
}

function MarkdownToolbar(props: {
  path: string
  mode: MarkdownPreviewMode
  onModeChange: (mode: MarkdownPreviewMode) => void
  outlineOpen: boolean
  onToggleOutline: () => void
  onCrumbClick: (dirPath: string) => void
  sourceLabel: string
  splitLabel: string
  previewLabel: string
  outlineLabel: string
}) {
  return (
    <div class="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border-base shrink-0">
      <div class="min-w-0 flex-1">
        <Breadcrumb path={props.path} onCrumbClick={props.onCrumbClick} />
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <SegmentedControlV2 value={props.mode} onChange={(v) => {
          if (v) props.onModeChange(v as MarkdownPreviewMode)
        }}>
          <SegmentedControlItemV2 value="source">{props.sourceLabel}</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="split">{props.splitLabel}</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="preview">{props.previewLabel}</SegmentedControlItemV2>
        </SegmentedControlV2>
        <Show when={props.mode !== "source"}>
          <IconButton
            icon="bullet-list"
            variant="ghost"
            size="small"
            class="size-7 rounded-md"
            classList={{ "bg-bg-layer-02": props.outlineOpen }}
            aria-label={props.outlineLabel}
            aria-pressed={props.outlineOpen}
            onClick={props.onToggleOutline}
          />
        </Show>
      </div>
    </div>
  )
}

type MarkdownHeading = { level: number; text: string }

// Parse ATX headings (# .. ######) from raw markdown source. Fenced code
// blocks are skipped so `#` comments inside code are not treated as headings.
function parseMarkdownOutline(source: string): MarkdownHeading[] {
  const lines = source.split(/\r?\n/)
  let inFence = false
  const result: MarkdownHeading[] = []
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^\s{0,3}(\#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const level = match[1].length
    const text = match[2].replace(/[`*_~]/g, "").trim()
    if (!text) continue
    result.push({ level, text })
  }
  return result
}

function MarkdownOutline(props: {
  headings: MarkdownHeading[]
  titleLabel: string
  emptyLabel: string
  onClose: () => void
  onSelect: (heading: MarkdownHeading, index: number) => void
}) {
  return (
    <div
      data-component="markdown-outline"
      class="absolute right-0 top-0 bottom-0 z-20 w-60 border-l border-border-base shadow-lg flex flex-col"
    >
      <div class="flex items-center justify-between px-3 py-2 text-12-medium text-text-muted border-b border-border-base shrink-0">
        <span class="truncate">{props.titleLabel}</span>
        <IconButton
          icon="close-small"
          variant="ghost"
          size="small"
          class="size-6 rounded-md shrink-0"
          onClick={props.onClose}
        />
      </div>
      <div class="flex-1 min-h-0 overflow-auto py-1">
        <Show
          when={props.headings.length > 0}
          fallback={<div class="px-3 py-2 text-12-regular text-text-weak">{props.emptyLabel}</div>}
        >
          <For each={props.headings}>
            {(heading, index) => (
              <button
                type="button"
                class="block w-full text-left py-1 pr-3 text-12-regular text-text-base hover:bg-bg-layer-02 transition-colors truncate"
                style={{ "padding-left": `${12 + (heading.level - 1) * 12}px` }}
                onClick={() => props.onSelect(heading, index())}
                title={heading.text}
              >
                {heading.text}
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}


export function FileTabContent(props: { tab: string }) {
  return (
    <Tabs.Content value={props.tab}>
      <SessionFileView tab={props.tab} />
    </Tabs.Content>
  )
}

export function SessionFileView(props: SessionFileViewProps) {
  const settings = useSettings()

  return (
    <Show when={settings.general.newLayoutDesigns()} fallback={<SessionFileViewV1 tab={props.tab} />}>
      <SessionFileViewV2 tab={props.tab} />
    </Show>
  )
}

function SessionFileViewV1(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableGutterUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

  const content = () => (
    <div class="mt-3 relative h-full min-h-0">
      <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
        <Switch>
          <Match when={state()?.loaded}>{renderFile(contents())}</Match>
          <Match when={state()?.loading}>
            <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
          </Match>
          <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
        </Switch>
      </ScrollView>
    </div>
  )

  return content()
}

function SessionFileViewV2(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const isMarkdown = createMemo(() => {
    const p = path()
    return p ? isMarkdownPath(p) : false
  })
  const previewMode = createMemo<MarkdownPreviewMode>(() => {
    if (!isMarkdown()) return "source"
    const p = path()
    return p ? (file.previewMode(p) ?? "split") : "source"
  })
  const setPreviewMode = (mode: MarkdownPreviewMode) => {
    const p = path()
    if (!p) return
    file.setPreviewMode(p, mode)
  }
  const [outlineOpen, setOutlineOpen] = createSignal(false)
  const splitSync = createSplitScrollSync()
  const [previewHost, setPreviewHost] = createSignal<HTMLDivElement>()
  const [splitRatio, setSplitRatio] = createSignal(0.5)
  let splitContainer: HTMLDivElement | undefined

  const onSplitterMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    if (!splitContainer) return
    const rect = splitContainer.getBoundingClientRect()
    const onMove = (ev: MouseEvent) => {
      const ratio = (ev.clientX - rect.left) / rect.width
      setSplitRatio(Math.min(0.85, Math.max(0.15, ratio)))
    }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, lines: SelectedLineRange) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selectionFromLines(lines))
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, input.selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, input.selection) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentControllerV2({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    getSide: selectionSide,
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenuV2
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableGutterUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          if (!range) {
            commentsUi.note.select(null)
            commentsUi.note.cancelDraft()
            return
          }
          commentsUi.onLineSelectionEnd(range)
        }}
        onLineNumberSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineNumberSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

  const renderMarkdownPreview = () => (
    <div class="px-6 py-4 max-w-3xl mx-auto">
      <Markdown text={contents()} cacheKey={cacheKey()} class="markdown-preview select-text" />
    </div>
  )

  const headings = createMemo(() => (isMarkdown() ? parseMarkdownOutline(contents()) : []))

  // Scroll the preview pane to the heading whose text matches the clicked
  // outline entry. We compute the offset manually and call scrollTo on the
  // preview container only — scrollIntoView would also scroll every ancestor
  // scroll container, causing the whole layout to jump.
  const scrollToHeading = (heading: MarkdownHeading) => {
    const host = previewHost()
    if (!host) return
    const levels = ["h1", "h2", "h3", "h4", "h5", "h6"]
    const candidates = Array.from(host.querySelectorAll<HTMLElement>(levels.join(",")))
    // parseMarkdownOutline strips markdown emphasis chars, so match loosely.
    const target = candidates.find((el) => {
      const text = (el.textContent ?? "").trim()
      return text === heading.text || text.includes(heading.text) || heading.text.includes(text)
    })
    if (!target) return
    const hostRect = host.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    host.scrollTo({ top: host.scrollTop + targetRect.top - hostRect.top - 8, behavior: "smooth" })
  }

  const onCrumbClick = (dirPath: string) => {
    file.tree.expand(dirPath)
  }

  const loadingBlock = () => (
    <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
  )

  const content = () => {
    // Non-markdown files keep the original single-pane code view.
    if (!isMarkdown()) {
      return (
        <div class="mt-3 relative h-full min-h-0">
          <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
            <Switch>
              <Match when={state()?.loaded}>{renderFile(contents())}</Match>
              <Match when={state()?.loading}>{loadingBlock()}</Match>
              <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
            </Switch>
          </ScrollView>
        </div>
      )
    }

    // Markdown files get a toolbar + mode-driven layout.
    return (
      <div class="mt-3 relative h-full min-h-0 flex flex-col">
        <MarkdownToolbar
          path={path() ?? ""}
          mode={previewMode()}
          onModeChange={setPreviewMode}
          outlineOpen={outlineOpen()}
          onToggleOutline={() => setOutlineOpen((v) => !v)}
          onCrumbClick={onCrumbClick}
          sourceLabel={language.t("session.markdown.source")}
          splitLabel={language.t("session.markdown.split")}
          previewLabel={language.t("session.markdown.preview")}
          outlineLabel={language.t("session.markdown.outline")}
        />
        <div class="flex-1 min-h-0 relative">
          <Switch>
            <Match when={previewMode() === "split"}>
              <div class="flex h-full" ref={splitContainer}>
                <div class="h-full min-w-0" style={{ width: `${splitRatio() * 100}%` }}>
                  <ScrollView class="h-full" viewportRef={splitSync.setSource}>
                    <Show when={state()?.loaded} fallback={loadingBlock()}>
                      {renderFile(contents())}
                    </Show>
                  </ScrollView>
                </div>
                <div
                  class="w-1 shrink-0 cursor-col-resize bg-v2-border-border-base hover:bg-v2-border-border-strong transition-colors relative"
                  onMouseDown={onSplitterMouseDown}
                >
                  <div class="absolute inset-y-0 -left-1 -right-1" />
                </div>
                <div class="h-full min-w-0 flex-1">
                  <ScrollView
                    class="h-full"
                    viewportRef={(el) => {
                      splitSync.setPreview(el)
                      setPreviewHost(el)
                    }}
                  >
                    <Show when={state()?.loaded} fallback={loadingBlock()}>
                      {renderMarkdownPreview()}
                    </Show>
                  </ScrollView>
                </div>
              </div>
            </Match>
            <Match when={previewMode() === "preview"}>
              <ScrollView class="h-full" viewportRef={setPreviewHost}>
                <Show when={state()?.loaded} fallback={loadingBlock()}>
                  {renderMarkdownPreview()}
                </Show>
              </ScrollView>
            </Match>
            <Match when={previewMode() === "source"}>
              <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
                <Show when={state()?.loaded} fallback={loadingBlock()}>
                  {renderFile(contents())}
                </Show>
              </ScrollView>
            </Match>
          </Switch>
          <Show when={outlineOpen() && previewMode() !== "source"}>
            <MarkdownOutline
              headings={headings()}
              titleLabel={language.t("session.markdown.outline")}
              emptyLabel={language.t("session.markdown.outline.empty")}
              onClose={() => setOutlineOpen(false)}
              onSelect={(heading) => scrollToHeading(heading)}
            />
          </Show>
        </div>
      </div>
    )
  }

  return content()
}
