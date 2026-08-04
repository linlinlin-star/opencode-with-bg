# 低开销动画增强计划

## Context

当前项目 UI 中许多交互元素(按钮、图标按钮、标签触发器、设置行)的 hover/active 状态是**瞬间切换**的,没有任何 transition,让界面感觉生硬。已有动画的组件(switch、select、dialog、toast)证明项目支持 CSS 动画,但覆盖面不够。

本计划通过纯 CSS 添加 8 项低开销动画,只使用 `transform`/`opacity`/`background-color`/`color`/`border-color`(均为合成器属性,不触发 layout reflow),让界面更灵动。

## 变更清单

### 1. 全局 `prefers-reduced-motion` 安全网
**文件:** `packages/ui/src/styles/base.css` (末尾追加)

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
用 `0.01ms` 而非 `0ms` 以保留 `transitionend`/`animationend` 事件触发。覆盖所有现有和新增动画。

### 2. Button v2 hover/active 过渡 (最高影响)
**文件:** `packages/ui/src/v2/components/button-v2.css`

在 `[data-component="button-v2"]` 基础规则(L7-25)中添加:
```css
  transition:
    background-color 0.12s ease-out,
    background-image 0.12s ease-out,
    color 0.12s ease-out;
```
覆盖全部 8 个变体的 hover/active/expanded 状态变化。`background-image` 覆盖 neutral/danger/warning/contrast 的渐变叠加;`background-color` 覆盖 outline/ghost/ghost-muted;`color` 覆盖 ghost-muted 的文字色变化。

### 3. Icon button v2 hover/active 过渡 (高影响)
**文件:** `packages/ui/src/v2/components/icon-button-v2.css`

在 `[data-component="icon-button-v2"]` 基础规则(L7-17)中添加同样的 transition:
```css
  transition:
    background-color 0.12s ease-out,
    background-image 0.12s ease-out,
    color 0.12s ease-out;
```

### 4. 标签触发器过渡 (中等影响)
**文件:** `packages/ui/src/v2/components/tabs-v2.css`

在三个现有规则中添加 transition:

- **Settings 竖直标签**(L202-208 `[data-slot="tabs-v2-trigger-wrapper"]`):
  ```css
  transition: background-color 0.12s ease-out, color 0.12s ease-out;
  ```
- **Pill 水平标签**(L152-158):
  ```css
  transition: background-color 0.12s ease-out, color 0.12s ease-out, border-color 0.12s ease-out;
  ```
- **Normal 水平标签**(L124-129):
  ```css
  transition: color 0.12s ease-out, border-color 0.12s ease-out;
  ```

### 5. 标签内容淡入动画 (中等影响)
**文件:** `packages/ui/src/v2/components/tabs-v2.css` (L29 后追加)

```css
@keyframes tabs-v2-content-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

[data-component="tabs-v2"] [data-slot="tabs-v2-content"][data-selected] {
  animation: tabs-v2-content-in 0.15s ease-out;
}
```
仅用 `opacity`+`transform`(GPU 合成),`translateY(2px)` 不影响布局。Kobalte 的 `data-selected` 属性切换时自动重播动画。

### 6. 设置行/卡片过渡 (中等影响)
**文件:** `packages/app/src/components/settings-v2/settings-v2.css`

在 4 个已有 hover 但无 transition 的规则中添加:

- **快捷键按钮** `.settings-v2-keybind-button`(L535): `transition: background-color 0.12s ease-out, color 0.12s ease-out;`
- **模型分组触发器** `.settings-v2-models-group-trigger`(L393): `transition: background-color 0.12s ease-out;`
- **查看全部提供者** `.settings-v2-providers-view-all`(L304): `transition: color 0.12s ease-out;`
- **规则折叠头** `.settings-v2-rule-summary`(L746): `transition: background-color 0.12s ease-out;`

### 7. 链接过渡 (低影响)
**文件:** `packages/app/src/components/settings-v2/settings-v2.css`

在 `[data-slot="settings-v2-row-description"] a.settings-v2-link`(L57)中添加:
```css
  transition: color 0.12s ease-out;
```

### 8. 用户消息气泡入场动画 (中等影响)
**文件:** `packages/session-ui/src/components/message-part.css`

文件顶部(L8 后)添加 keyframes:
```css
@keyframes message-bubble-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

在 `[data-slot="user-message-text"]`(L136)规则中添加:
```css
  animation: message-bubble-in 0.15s ease-out;
```

仅针对用户消息(非 AI 回复),因为 AI 回复是流式输出,入场动画会与打字机效果冲突。用户消息是原子提交,适合入场动画。

## 性能说明

| 属性 | 开销 | 使用场景 |
|---|---|---|
| `transform` | GPU 合成,零 layout | 内容入场、消息气泡 |
| `opacity` | GPU 合成,零 layout | 内容入场、消息气泡 |
| `background-color` | 仅 paint,无 layout | 按钮/标签/行 hover |
| `background-image` | 仅 paint,无 layout | 按钮 hover 渐变叠加 |
| `color` | 仅 paint,无 layout | 文字色 hover |
| `border-color` | 仅 paint,无 layout | 标签选中边框 |

全部时长 0.12-0.15s,`ease-out`,感觉灵敏。不动画 `width`/`height`/`top`/`left`/`margin`/`padding`。

## 验证方式

1. 启动 dev 服务器,打开设置对话框
2. 验证按钮 hover 有平滑过渡(~0.12s)
3. 验证标签切换有淡入效果(~0.15s)
4. 验证设置行 hover 有平滑过渡
5. 发送一条消息,验证用户气泡淡入
6. 开启系统"减少动画"设置,验证所有动画变为即时
7. 运行 `bun typecheck`(packages/app)— 纯 CSS 变更不影响类型,但确认无误
