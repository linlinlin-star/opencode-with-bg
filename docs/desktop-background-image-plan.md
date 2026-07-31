# Electron 桌面应用「外观 → 背景图片」功能方案

> 目标：在桌面应用「设置 → 通用 → 外观」中新增「背景图片」功能，复刻 VSCode `background` 插件的显示效果——背景图铺在窗口最底层，应用内容面板呈半透明，图片透过内容区域隐约可见，并可调节图片不透明度、模糊、尺寸/平铺以及内容压暗程度以兼顾可读性。
>
> 适用范围：仅 Electron 桌面端（`packages/desktop` + 共享层 `packages/app`）。Web 端不显示该设置项，零影响。

---

## 一、目标效果

复刻 VSCode `background` 插件的视觉特征：

1. 背景图作为窗口最底层铺满显示。
2. 应用内容面板（聊天区、侧栏、标题栏等）呈半透明，使图片透过内容区域隐约可见。
3. 用户可调节：
   - 图片层不透明度（`opacity`）
   - 高斯模糊（`blur`）
   - 背景尺寸（`cover` / `contain` / `auto`）
   - 是否平铺（`repeat`）
   - 内容压暗程度（`dim`，控制内容面板透明度，平衡可读性）
4. 仅桌面端启用；Web 端不显示该设置项。

---

## 二、关键设计决策

### 1. 图片存储策略

**采用固定文件名方案**（方案 B 的优化版）：

选择图片时统一缩放后以 PNG 格式拷贝到 `userData/background-image`（无扩展名），避免通配符匹配多个文件的冲突。删除旧图时直接删该文件。同时前置校验文件大小（>20MB 提示用户），并支持 SVG 格式。

> 决策依据：曾考虑「仅存源文件路径到 settings」与「base64 data URL 直接存 settings」两种方案。前者在源文件被移动/删除时即失效；后者会让 settings JSON 膨胀，拖慢 electron-store 读写。故选用「拷贝到 userData + 固定文件名 + settings 只存配置」的组合，兼顾持久性与读写性能。

### 2. 图层架构（复刻 VSCode-background 的核心）

```
┌─ BrowserWindow backgroundColor (theme --background-base, 不透明)  ← 最底层
├─ body::before  背景图片层 (fixed, cover, opacity/blur 可调)        ← 图片层
├─ body 内容     --background-base 在启用时被覆写为 rgba(…, 1-dim)   ← 半透明内容
└─ 文字 / 控件                                                      ← 最上层
```

要点：

- `--background-base` 保持不透明，供窗口底色与启动闪屏使用。
- 新增 `body[data-bg-image="true"]::before` 渲染图片层。
- 启用时把 `--background-base` 覆写为 `rgba(<基础色 rgb>, 1 - dim)`，于是所有 `bg-background-base` 面板（聊天区、侧栏等）自然变半透明，图片透出——这正是 VSCode-background 的手法。
- 基础色 RGB 从 `getComputedStyle(document.documentElement).getPropertyValue("--background-base")` 读取（与现有桌面端 `Inner` 组件做法一致）。

### 3. 数据模型

在 `packages/app/src/context/settings.tsx` 的 `appearance` 字段增加 `backgroundImage`：

```ts
appearance: {
  fontSize: number
  mono: string
  sans: string
  terminal: string
  backgroundImage?: {
    enabled: boolean
    opacity: number   // 图片层不透明度 0–1，默认 0.6
    blur: number      // 高斯模糊 px，默认 0
    size: "cover" | "contain" | "auto"   // 默认 cover
    repeat: boolean   // 默认 false
    dim: number       // 内容压暗 0–1（0=内容不透明，1=完全透明），默认 0.15
  }
}
```

- `defaultSettings.appearance.backgroundImage` 设为 `undefined`（首启无背景）。
- **图片文件路径不入 settings**（由 userData 文件存在性决定），避免路径失效与跨平台路径问题。
- **状态机**：`enabled=false` + 有文件 = 不清除文件仅隐藏；`enabled=true` + 无文件 = 运行时静默回退纯色背景，但**不落盘改 `enabled`**（避免外部删文件后污染用户偏好，待下次 `getBackgroundImage()` 真拿到图再自动恢复）；所有 IPC/文件操作均有 `try/catch` 兜底，失败时回退且不影响主体功能。
- **深色主题**：动态读取 `--background-base` 亮度，暗底色时自动降低 `dim` 默认值至 0.08 以保证图片可见。实现方式：解析 `--background-base` 为 RGB，按 WCAG 相对亮度公式 `L = 0.2126*R + 0.7152*G + 0.0722*B`（各通道经 gamma 校正 `((c+0.055)/1.055)^2.4`）计算，`L < 0.25` 视为暗色。阈值取 0.25 是因为 sRGB 中灰 `#808080` 经 gamma 校正后 L≈0.22，0.25 恰落在中灰偏下，可干净区分暗色主题（`#1e1e1e`→0.013、`#0d1117`→0.005）与浅色主题（`#ffffff`→1.0）；若取 0.5 则反推约为 `#BB`，会把大量偏浅中灰误判为暗色。

---

## 三、分层改动清单

### Layer 1 — 共享 settings（packages/app）

**文件：`packages/app/src/context/settings.tsx`**

- 扩展 `Settings.appearance` 类型与 `defaultSettings`，新增 `backgroundImage` 字段。
- 在 `SettingsProvider` 内为 `appearance` 增加访问器与 setter：
  - `backgroundImage.enabled` / `setEnabled`
  - `opacity` / `setOpacity`
  - `blur` / `setBlur`
  - `size` / `setSize`
  - `repeat` / `setRepeat`
  - `dim` / `setDim`
  - 写法仿照现有 `setFont`。
- 新增 `createEffect`：当 `backgroundImage?.enabled` 且渲染层已注入图片 data URL 时：
  - 把图片 URL / opacity / blur / size / repeat 写入 CSS 变量：`--app-bg-image`、`--app-bg-opacity`、`--app-bg-blur`、`--app-bg-size`、`--app-bg-repeat`。
  - 切换 `document.body` 的 `data-bg-image` 属性。
  - 根据 `dim` 把 `--background-base` 覆写为 `rgba(<rgb>, 1 - dim)`。
- **避免共享层直接耦合桌面 IPC**：图片 data URL 的获取放在桌面端，通过一个新的可空回调 `resolveBackgroundImage?: () => Promise<string | null>` 注入 settings provider。Web 端不注入，effect 自动 no-op。

### Layer 2 — 设置 UI（packages/app）

**文件：`packages/app/src/components/settings-v2/general-controllers.ts`**

- `createAppearanceSettingsController` 增加 `background` 子控制器：
  - 信号：`enabled`、`opacity`、`blur`、`size`、`repeat`、`dim`、`hasImage`
  - 方法：`pick()`（调 platform 选图）、`clear()`（调 platform 清除）

**文件：`packages/app/src/components/settings-v2/general.tsx`**

- 在 `AppearanceSection` 内、字体设置之后，用 `<Show when={desktop()}>` 渲染新的 `BackgroundImageSection`：
  - 一行「背景图片」开关（`Switch`，绑定 `enabled`）
  - 一行「选择图片」按钮（`ButtonV2`，触发 `pick()`）+ 缩略图预览 + 「清除」按钮（`Show when={hasImage}`）
  - 数值滑杆：不透明度、模糊、内容压暗
  - `SelectV2`：尺寸（cover/contain/auto）；`Switch`：平铺
- 复用 `SettingsListV2` / `SettingsRowV2`，样式自动继承 `settings-v2.css`。

**文件：`packages/app/src/i18n/en.ts` 与 `packages/app/src/i18n/zh.ts`**

新增 i18n 键：

```
settings.general.row.backgroundImage.title
settings.general.row.backgroundImage.description
settings.general.row.backgroundImage.choose
settings.general.row.backgroundImage.clear
settings.general.row.backgroundImage.opacity
settings.general.row.backgroundImage.blur
settings.general.row.backgroundImage.dim
settings.general.row.backgroundImage.size
settings.general.row.backgroundImage.repeat
settings.general.backgroundImage.size.cover
settings.general.backgroundImage.size.contain
settings.general.backgroundImage.size.auto
```

### Layer 3 — 背景图层渲染

**文件：`packages/app/src/app.tsx`**

- 在 `SharedProviders` 内（紧邻 `BodyDesignClass`）新增一个 `BackgroundImageLayer` 组件：
  - 读取 settings + 桌面注入的图片 URL。
  - 写入上述 CSS 变量与 `data-bg-image` 属性。
  - 返回 `null`，纯副作用组件，与 `BodyDesignClass` 风格一致。

**文件：`packages/app/src/index.css`（或 `packages/ui` 主题 css）**

追加：

```css
body[data-bg-image="true"]::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: var(--app-bg-image, none);
  background-size: var(--app-bg-size, cover);
  background-position: center;
  background-repeat: var(--app-bg-repeat, no-repeat);
  opacity: var(--app-bg-opacity, 1);
  filter: blur(var(--app-bg-blur, 0));
}

/* 使用属性选择器而非子代选择器，兼容 #root 外层可能存在的 provider 包裹层 */
body[data-bg-image="true"] #root,
body[data-bg-image="true"] [data-app-root] {
  position: relative;
  z-index: 1;
}
```

### Layer 4 — Platform 接口（packages/app）

**文件：`packages/app/src/context/platform.tsx`**

`PlatformBase` 新增三个可选方法（桌面专用）：

```ts
/** 选择并持久化一张背景图，返回 data URL 与尺寸（desktop only） */
pickBackgroundImage?(): Promise<{ dataURL: string; width: number; height: number } | null>

/** 读取已持久化的背景图（desktop only） */
getBackgroundImage?(): Promise<{ dataURL: string; width: number; height: number } | null>

/** 清除已持久化的背景图（desktop only） */
clearBackgroundImage?(): Promise<void>
```

### Layer 5 — 桌面渲染层实现（packages/desktop/renderer）

**文件：`packages/desktop/src/renderer/index.tsx`**

- `createPlatform` 实现三个新方法，转调 `window.api.*`：

```ts
pickBackgroundImage: () => window.api.pickBackgroundImage(),
getBackgroundImage: () => window.api.getBackgroundImage(),
clearBackgroundImage: () => window.api.clearBackgroundImage(),
```

- 在 `DesktopRoot` 内挂载时调用 `getBackgroundImage()` 取回持久化图片，注入给 settings provider（经 Layer 1 的回调）。
- `Inner` 组件现有的 `setBackgroundColor` effect 保持不变（窗口底色仍用不透明 `--background-base`）。

### Layer 6 — Preload 桥（packages/desktop）

**文件：`packages/desktop/src/preload/index.ts`**

`api` 增三项：

```ts
pickBackgroundImage: () => ipcRenderer.invoke("pick-background-image"),
getBackgroundImage: () => ipcRenderer.invoke("get-background-image"),
clearBackgroundImage: () => ipcRenderer.invoke("clear-background-image"),
```

**文件：`packages/desktop/src/preload/types.ts`**

`ElectronAPI` 增加对应类型签名：

```ts
pickBackgroundImage: () => Promise<{ dataURL: string; width: number; height: number } | null>
getBackgroundImage: () => Promise<{ dataURL: string; width: number; height: number } | null>
clearBackgroundImage: () => Promise<void>
```

### Layer 7 — 主进程 IPC + 文件管理（packages/desktop）

**新建文件：`packages/desktop/src/main/background-image.ts`**

- `pickBackgroundImage(win)`：
  - 调 `dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Images", extensions: ["png","jpg","jpeg","gif","webp","bmp","svg"] }] })`。
  - 前置检查文件大小，>20MB 则弹提示拒绝。
  - 把选中文件统一缩放为 PNG 格式直接覆写到 `userData/background-image`（固定文件名无扩展名）。无需先删再写——固定 PNG 路径下直接覆写即可，避免「先删再写」期间其他窗口 `getBackgroundImage()` 拿到 null 的短窗口；删旧文件逻辑只在「清除」动作里做。
  - 用 `nativeImage.createFromPath(path)` 读取尺寸；可选 `resize` 限制到 ≤1920px 宽，降低内存与重绘成本。
  - 返回 `{ dataURL, width, height }`。
- `getBackgroundImage()`：
  - 读取 `userData/background-image`，存在则返回 data URL + 尺寸，否则 `null`。
- `clearBackgroundImage()`：
  - 删除该文件。

**文件：`packages/desktop/src/main/index.ts`**

`registerIpcHandlers` 增加三个 handler：

```ts
pickBackgroundImage: (win) => pickBackgroundImage(win),
getBackgroundImage: () => getBackgroundImage(),
clearBackgroundImage: () => clearBackgroundImage(),
```

> 注意：需确认 `registerIpcHandlers` 是否已把 `win`（`BrowserWindow`）透传给 handler；如未透传，需补充（picker 需要 parent window）。

---

## 四、边缘情况与注意点

1. **多窗口一致性**：背景图文件在 `userData` 共享，每个窗口启动时各自 `getBackgroundImage()`，效果一致。settings 也全局共享。
2. **主题切换/明暗**：`--background-base` 随主题变化，`dim` 覆写需在主题切换后重算——把覆写 effect 依赖 `theme.themeId()` / `theme.mode()` 即可（现有 `Inner` 已是此模式）。
3. **窗口底色 vs rgba**：`setBackgroundColor` 仅接收不透明色；`dim` 只作用于 DOM 内的 `--background-base`，窗口底色保持不透明，避免 Electron 接收 rgba 报错。
4. **启动闪屏**：`LoadingSplash` 用 `bg-background-base`，启用背景时它会半透明——但闪屏期间图片层尚未注入，背后是不透明窗口底色，无视觉问题。
5. **性能**：超大图片用 `nativeImage.resize` 限制到 ≤1920px 宽，降低内存与重绘成本。
6. **可访问性**：默认 `dim=0.15` 保证文字对比度；UI 上对 `dim`/`opacity` 给出「可读性」提示文案。
7. **Web 端**：整段背景图 UI 用 `<Show when={desktop()}>` 隔离，Web 端零影响。
8. **图片清理**：卸载/清除时删除 `userData/background-image`，避免残留。

---

## 五、可选增强（后续迭代）

- 支持 URL 在线背景图（Web 端也可用）。
- 多图轮播 / 每日一图。
- 背景图遮罩色（默认黑，可调）。
- 导入/导出背景配置。
- 每个会话/窗口独立背景。

---

## 六、改动文件汇总

| 层 | 文件 | 改动 |
|---|---|---|
| settings | `packages/app/src/context/settings.tsx` | schema + setter + CSS 变量 effect |
| UI | `packages/app/src/components/settings-v2/general-controllers.ts` | `background` 子控制器 |
| UI | `packages/app/src/components/settings-v2/general.tsx` | 背景图设置行 |
| i18n | `packages/app/src/i18n/{en,zh}.ts` | 新文案 |
| 图层 | `packages/app/src/app.tsx` | `BackgroundImageLayer` 组件 |
| 图层 | `packages/app/src/index.css` | `body::before` 图片层样式 |
| platform | `packages/app/src/context/platform.tsx` | 3 个可选方法 |
| 桌面渲染 | `packages/desktop/src/renderer/index.tsx` | platform 实现 + 启动注入 |
| preload | `packages/desktop/src/preload/index.ts` | 3 个桥方法 |
| preload | `packages/desktop/src/preload/types.ts` | 类型签名 |
| 主进程 | **新增** `packages/desktop/src/main/background-image.ts` | 文件管理 |
| 主进程 | `packages/desktop/src/main/index.ts` | 3 个 IPC handler |

---

## 七、实现顺序建议

1. **Layer 7** 主进程文件管理 + IPC（先有数据来源）
2. **Layer 6** preload 桥 + 类型
3. **Layer 5** 桌面渲染层 platform 实现
4. **Layer 4** Platform 接口
5. **Layer 1** settings schema + setter + CSS 变量 effect
6. **Layer 3** 背景图层组件 + CSS
7. **Layer 2** 设置 UI + i18n
8. 联调：选图 → 应用 → 重启验证持久化 → 调参 → 主题切换验证

每层完成后可独立验证，降低联调风险。

---

## 八、验收标准

- [ ] 桌面端「设置 → 通用 → 外观」可见「背景图片」设置区；Web 端不可见。
- [ ] 可选择本地图片作为背景，选择后立即生效。
- [ ] 重启应用后背景图仍在（持久化）。
- [ ] 可调节不透明度、模糊、尺寸、平铺、内容压暗，实时生效。
- [ ] 启用背景时内容面板半透明、文字仍清晰可读（默认 `dim=0.15`）。
- [ ] 可清除背景图，清除后恢复纯色主题底。
- [ ] 主题切换（明/暗）后背景效果与可读性正常。
- [ ] 多窗口下背景一致。
