# 恢复 Markdown 文件预览 + Mermaid 渲染 + 分屏同步滚动

## Context

Electron 桌面应用曾在 2026-07-30 实现过 .md 文件预览（面包屑、大纲、预览/源码切换）和 Mermaid 渲染，但在 `git reset` 到 `upstream/dev` 时 TS 逻辑全部丢失。幸运的是 `markdown.css` 中的 Mermaid 样式（L306-420，含缩放控制）幸存。当前 .md 文件在文件浏览器中只能以纯文本源码显示。

本次目标：
1. 恢复并升级为**分屏同步滚动**（左源码右预览，按比例同步滚动）
2. 恢复**面包屑路径** + **标题大纲导航**
3. 新增 **Mermaid 图表渲染**支持

约束：遵循 AGENTS.md（Bun API、避免 any、const 优先、createStore 优先、CSS-only 动画含 prefers-reduced-motion）。Mermaid 仅在 session-ui 渲染，文件查看器在 app 包。

## 关键发现（复用现有实现）

- `markdown.css` L306-420 **已有完整 Mermaid 样式**（`.mermaid-diagram`、`[data-error]`、`.mermaid-controls` 缩放按钮）→ **无需新增 CSS**
- `Markdown` 组件（[markdown.tsx:355](file:///e:/Trae/workbench/opencode/packages/session-ui/src/components/markdown.tsx#L355)）接收 `text`/`cacheKey`，可在文件预览直接复用
- `code()` 函数（[markdown.tsx:69](file:///e:/Trae/workbench/opencode/packages/session-ui/src/components/markdown.tsx#L69)）处理所有代码块（含 mermaid），是核心拦截点；`marked.parse` 只处理非 code 文本块，所以 mermaid 不会走 shiki
- `SegmentedControlV2`/`IconButtonV2`/`TooltipV2`（`packages/ui/src/v2/components/`）可用于工具栏
- `FileViewState`（[types.ts:17](file:///e:/Trae/workbench/opencode/packages/app/src/context/file/types.ts#L17)）按路径缓存，可扩展存预览模式
- `createScrollSync`（[file-tabs.tsx:92](file:///e:/Trae/workbench/opencode/packages/app/src/pages/session/file-tabs.tsx#L92)）针对 diff 代码块，不可直接复用，需新建分屏同步

---

## 任务一：Mermaid 渲染（session-ui + ui）

### 1.1 添加依赖
`packages/session-ui/package.json` 的 `dependencies` 加 `"mermaid": "^11.4.0"`，然后 `bun install`。

### 1.2 `packages/ui/src/context/marked.tsx`（防御性拦截）
- 在 `renderMathExpressions` 附近加 `wrapMermaid(source)` 辅助：base64 编码 UTF-8 源码，返回 `<div class="mermaid-diagram" data-source="..."></div>`
- `highlightCodeBlocks` (L479) 的 for 循环开头：`if (lang === "mermaid") { result = result.replace(fullMatch, () => wrapMermaid(code)); continue }`（Native 路径，桌面应用不用，防御性）
- `markedShiki` 的 `highlight` 回调 (L536) 开头：`if (lang === "mermaid") return wrapMermaid(code)`（JS 全量路径，防御性）

> 说明：桌面应用走流式路径，code 块由 `markdown.tsx` 的 `code()` 处理，不经过 `marked.parse`。此处拦截仅防御 nativeParser/直接 parse 场景。

### 1.3 `packages/session-ui/src/components/markdown-cache.tsx`
DOMPurify `ADD_ATTR` (L19) 追加 `"data-source", "data-rendered", "data-error"`。Mermaid SVG 通过 `div.innerHTML` 在 sanitize 之后注入，绕过 DOMPurify（mermaid `securityLevel:"strict"` 保证安全）。

### 1.4 `packages/session-ui/src/components/markdown.tsx`（核心）
- `code()` (L69) 开头加 mermaid 分支：`if (language === "mermaid")` 跳过 shiki worker，返回 `{ language:"mermaid", generation:0, stable:[[encoded,""]], unstable:[] }`
- `updateCodeBlock()` (L596) 开头加 mermaid 分支：渲染 `<div class="mermaid-diagram" data-source="...">` 占位，不复用 code 标签逻辑
- 新增模块级 `mermaidCache: Map<string,string>`（源码→SVG）和 `renderMermaidDiagrams(root)`：
  - 查询 `.mermaid-diagram:not([data-rendered]):not([data-rendering])`
  - 动态 `import("mermaid")`，`initialize({ startOnLoad:false, theme, securityLevel:"strict" })`
  - 主题取自 `document.documentElement.dataset.colorScheme`（dark→"dark"，否则"default"）
  - 逐个 `mermaid.render(id, source)` → 缓存 → `div.innerHTML = svg`
  - 失败设 `data-error="true"` + `.mermaid-error` 文本
- `createEffect` (L458) 在 `content.forEach(updateBlock)` 之后加 `void renderMermaidDiagrams(container)`
- 新增主题切换 `MutationObserver`：监听 `<html>` 的 `data-color-scheme`，变化时清缓存、清除 `data-rendered`、重新渲染

### 1.5 `markdown.css`
**无需改动**（L306-420 已有样式）。缩放控制按钮（`.mermaid-controls`）的 TS 逻辑本次不恢复（超出当前需求），CSS 保留备用。

---

## 任务二：分屏同步滚动 md 预览（app）

### 2.1 `packages/app/src/context/file/path.ts`
新增 `isMarkdownPath(path)`：扩展名集合 `{".md",".markdown",".mdx"}` 判断（小写）。

### 2.2 `packages/app/src/context/file/types.ts`
- `FileViewState` 加 `previewMode?: MarkdownPreviewMode`
- 新增 `export type MarkdownPreviewMode = "source" | "preview" | "split"`

### 2.3 `packages/app/src/context/file/view-cache.ts`
仿 `selectedLines` 模式加 `previewMode(path)` 读取 + `setPreviewMode(path, mode)` 写入（用 `produce`），在 `createViewSession` 返回。

### 2.4 `packages/app/src/context/file.tsx`
仿 `selectedLines`/`setSelectedLines` (L259-261) 加 `previewMode`/`setPreviewMode`，加入返回对象。

### 2.5 `packages/app/src/pages/session/file-tabs.tsx`（核心集成）
修改 `SessionFileViewV2` (L511)：

**新增 `createSplitScrollSync()`**（在 `createScrollSync` 下方）：
- `setSource(el)` / `setPreview(el)` 绑定两栏 ScrollView
- `sync(from, to)`：`ratio = from.scrollTop / (from.scrollHeight - from.clientHeight)`，`to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)`
- `syncing` 标志 + RAF 打破反馈循环

**新增 `MarkdownToolbar` 组件**：
- 左侧：`Breadcrumb`（路径按 `/` 分段，`chevron-right` 分隔，点击父级展开文件树）
- 右侧：`SegmentedControlV2`（源码/分屏/预览三选一）+ `IconButtonV2`（大纲开关，`TooltipV2` 标注）

**`SessionFileViewV2` 主体改造**：
- `isMarkdown = createMemo(() => path() ? isMarkdownPath(path()!) : false)`
- `previewMode = createMemo(() => isMarkdown() ? (file.previewMode(path()!) ?? "split") : "source")`（.md 默认 split）
- `setPreviewMode(mode)` 调 `file.setPreviewMode`
- 抽出 `sourceView()`（现有 `renderFile` + ScrollView + scrollSync，保持不变）
- 新增 `previewView()`：`<ScrollView viewportRef={splitSync.setPreview}><Markdown text={contents()} cacheKey={cacheKey()} class="markdown-file-preview" /></ScrollView>`
- 新增 `splitView()`：flex 行布局，左 `sourceView()`（viewportRef=splitSync.setSource）右 `previewView()`
- `content()` 改为：非 md 或未加载 → `sourceView()`；md → 按 `previewMode()` 切 source/preview/split
- 工具栏 `MarkdownToolbar` 仅在 `isMarkdown() && state()?.loaded` 时显示

---

## 任务三：面包屑 + 标题大纲导航（app，同在 file-tabs.tsx）

### 3.1 面包屑 `Breadcrumb`
- 路径按 `/\\` 分段，累积父目录路径
- 每段按钮点击 → `file.tree.expand(dirPath)`（在文件树展开该目录）
- 末段（文件名）加粗，不可点击
- 长路径用 `truncate` + `min-w-0` 截断

### 3.2 大纲 `createHeadingOutline(container)`
- `headings` signal：`{ id, level, text, top }[]`
- `MutationObserver` 监听预览容器 `childList`+`subtree`，提取 `h1-h6`，自动补 `id="md-heading-{i}"`
- 防抖（RAF 或 100ms）避免流式更新频繁触发
- `onCleanup` 断开 observer

### 3.3 大纲面板
- `outline()` signal 控制开关，工具栏 `IconButtonV2` 切换
- 面板宽 ~240px，渲染标题树（按 level 缩进）
- 点击标题 → 预览 ScrollView 滚动到 `heading.top - 8`
- 跟踪预览 `onScroll` 高亮当前最近标题（`offsetTop <= scrollTop + threshold`）
- CSS-only 滑入动画 `transform: translateX()` + `opacity`，含 `@media (prefers-reduced-motion: reduce)` 禁用

---

## i18n

`packages/app/src/i18n/en.ts`（L679 附近）和 `zh.ts` 对应位置新增：
- `session.files.markdown.source` / `session.files.markdown.preview` / `session.files.markdown.split`
- `session.files.markdown.outline`
- `session.files.markdown.copyPath`

---

## 验证

### Typecheck
```powershell
cd e:\Trae\workbench\opencode\packages\session-ui; bun typecheck
cd e:\Trae\workbench\opencode\packages\app; bun typecheck
cd e:\Trae\workbench\opencode\packages\ui; bun typecheck
```

### 手动测试（Electron 桌面应用，sandbox 禁用）
1. 打开 .md 文件 → 工具栏出现（面包屑+模式切换），默认分屏，左源码右预览，滚动同步
2. 切换源码/预览/分屏 → 各模式正确；切到其他 .md 再切回 → 模式保持
3. 打开 .ts/.json → 无工具栏，纯源码（原行为）
4. 面包屑点击父目录 → 文件树展开
5. 大纲开关 → 标题列表，点击滚动定位，滚动高亮当前标题
6. 含 ` ```mermaid ` 的 .md → 预览渲染流程图 SVG；测试 sequenceDiagram/gantt/pie
7. 切换暗/亮主题 → mermaid 重渲染
8. 无效 mermaid 语法 → 显示 `data-error` 错误文本
9. 会话消息中的 mermaid 块 → 同样渲染（Markdown 组件共享）

## 风险与权衡
- **滚动同步精度**：按比例同步是标准做法（VSCode/Typora），首版可接受；精确行映射需深度耦合源码编辑器与渲染器，暂不做
- **Mermaid 包体积**（~800KB）：动态 import，首次遇 mermaid 块才加载，不阻塞启动
- **`securityLevel:"strict"`**：禁用 HTML 标签和点击，安全渲染不可信模型输出
- **预览模式持久化范围**：按路径存（跨会话共享），默认 split，符合 VSCode 习惯

## 实施顺序
1. Mermaid（任务一 1.1-1.5）— 独立，可先在会话消息验证
2. 路径检测+类型+缓存（任务二 2.1-2.4）— 基础设施
3. 分屏+工具栏+滚动同步（任务二 2.5）
4. 面包屑+大纲（任务三 3.1-3.3）
5. i18n + typecheck + 手动测试
