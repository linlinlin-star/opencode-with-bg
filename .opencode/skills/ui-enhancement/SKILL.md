---
name: ui-enhancement
description: 提升和调整 opencode 前端 UI 的布局、间距、视觉层次与交互一致性，基于 v2 设计令牌和现有组件模式
---

# UI 提升

当用户请求调整或提升 UI 布局、样式、视觉层次时，遵循以下规范。

## 设计令牌

项目使用 `--v2-*` CSS 自定义属性作为设计令牌，不要硬编码颜色或尺寸。

### 颜色层级（由浅到深）

| 令牌 | 用途 |
|---|---|
| `--v2-background-bg-base` | 卡片、面板的基础背景 |
| `--v2-background-bg-layer-01` | 卡片内嵌套元素的背景（如列表、折叠面板） |
| `--v2-text-text-base` | 主要文本 |
| `--v2-text-text-secondary` | 次要文本（描述、内容预览） |
| `--v2-text-text-muted` | 辅助文本（提示、图标、箭头） |
| `--v2-text-text-accent` | 强调色（链接、主操作） |
| `--v2-border-border-base` | 主分隔线 |
| `--v2-border-border-muted` | 次分隔线（卡片边框、行间分隔） |

### 排版

| 场景 | 字号 | 字重 |
|---|---|---|
| 页面标题（tab-title） | 15px | 640 |
| 区域标题（section-title） | 15px | 640 |
| 卡片标题 | 13px | 600 |
| 卡片内子区域标题 | 12px | 600 + text-secondary |
| 正文 / 列表项 | 12-13px | 400-500 |
| 等宽内容（路径、代码） | 12px | 400 + `var(--font-mono)` |

### 间距

| 场景 | 值 |
|---|---|
| tab-body 区域间距 | 36px（flex gap） |
| 卡片间距 | 14px（margin-top） |
| 卡片内边距 | 14px 16px |
| 卡片头部下边距 | 10px |
| 子区域间距 | 14px + 0.5px 分隔线 |
| 行内间距 | 8px |
| 圆角 | 卡片 10px / 嵌套元素 8px |

## 布局模式

### 区域结构

```
panel (flex column, overflow-y auto, scrollbar hidden)
  └── tab-header (sticky top, padding 40px 40px 32px, gradient fade)
      └── tab-title
  └── tab-body (flex column, gap 36px, padding 0 40px 40px)
      └── section (flex column, gap 16px)
          └── section-title
          └── SettingsListV2 / 自定义内容
```

### 卡片结构（用于规则、Profile 等分组内容）

```
rules-card (padding 14px 16px, radius 10px, inset border)
  └── rules-card-header (flex, space-between, margin-bottom 10px)
      └── rules-card-title (13px / 600)
      └── 操作按钮 (ButtonV2 ghost-muted small)
  └── 内容区域
```

### 视觉层次原则

1. **嵌套层次用背景色区分**：卡片用 `bg-base`，卡片内嵌套元素用 `bg-layer-01`
2. **标题层级用字号+颜色递减**：页面标题 > 区域标题 > 卡片标题 > 子区域标题
3. **分隔线用 border 宽度区分**：区域间用 `border-base`，卡片内子区域间用 `border-muted`
4. **操作按钮统一风格**：次要操作用 `variant="ghost-muted" size="small"`，主操作用 `variant="contrast"`

## 折叠/展开交互

所有 `<details>` 元素统一使用箭头指示器：

```css
.summary::before {
  content: "▸";
  display: inline-block;
  margin-right: 6px;
  color: var(--v2-text-text-muted);
  transition: transform 0.15s ease;
  font-size: 10px;
}

details[open] .summary::before {
  transform: rotate(90deg);
}
```

隐藏原生 marker：`::-webkit-details-marker { display: none; }` + `list-style: none`

## 动画规范

1. **仅用 CSS**：transform + opacity，避免触发 layout reflow
2. **过渡时长**：0.15s（微交互）到 0.3s（面板展开）
3. **必须包含无障碍降级**：

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

4. **staggered 动画**：每行延迟 30ms，最多 8 行
5. **hover 效果**：用 `transform: scale()`，150ms transition

## 组件使用

| 场景 | 组件 |
|---|---|
| 设置列表 | `SettingsListV2` + `SettingsRowV2` |
| 按钮 | `ButtonV2`（ghost-muted / contrast） |
| 图标按钮 | `IconButtonV2` |
| 开关 | `Switch` |
| 输入框 | `TextInputV2` |
| 文本域 | `TextareaV2` |
| 下拉选择 | `SelectV2` |
| 提示 | `TooltipV2` |
| 图标 | `Icon name="..."` |
| 对话框 | `DialogV2` |
| 标签页 | `TabsV2` |

## i18n

所有用户可见文本必须使用 `language.t("key")`，不得硬编码。新增 key 需同时添加到 `en.ts` 和 `zh.ts`。

## 检查清单

调整 UI 前后逐项确认：

- [ ] 颜色使用 `--v2-*` 令牌，无硬编码
- [ ] 间距符合层级（区域 > 卡片 > 行）
- [ ] 标题层级递减（页面 > 区域 > 卡片 > 子区域）
- [ ] 嵌套元素有背景色区分
- [ ] 折叠面板有箭头指示器
- [ ] 动画包含 `prefers-reduced-motion` 降级
- [ ] 文本走 i18n
- [ ] `bun typecheck` 通过
