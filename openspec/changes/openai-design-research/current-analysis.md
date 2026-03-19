# 当前 Dashboard 设计分析

## 现有颜色系统 (Matrix 主题)

### CSS 变量
```css
--matrix-bg: #050505              /* 背景 */
--matrix-panel-bg: rgba(0, 10, 0, 0.7)  /* 面板背景 */
--matrix-panel-border: rgba(0, 255, 65, 0.18)  /* 面板边框 */
--matrix-panel-border-strong: rgba(0, 255, 65, 0.32)
--matrix-ink: #00ff41             /* 主绿色 */
--matrix-ink-bright: #e8ffe9      /* 亮绿色 */
--matrix-ink-muted: rgba(0, 255, 65, 0.6)
--matrix-ink-dim: rgba(0, 255, 65, 0.35)
--matrix-ink-ghost: rgba(0, 255, 65, 0.18)
--matrix-glow: rgba(0, 255, 65, 0.45)  /* 发光效果 */
--matrix-display-size: clamp(48px, 6vw, 72px)
--matrix-heading-size: 14px
--matrix-body-size: 16px
--matrix-caption-size: 12px
```

### Tailwind 颜色配置
```javascript
colors: {
  matrix: {
    primary: "#00FF41",
    bright: "#E8FFE9",
    muted: "rgba(0, 255, 65, 0.6)",
    dim: "rgba(0, 255, 65, 0.35)",
    ghost: "rgba(0, 255, 65, 0.18)",
    panel: "rgba(0, 10, 0, 0.7)",
    panelStrong: "rgba(0, 10, 0, 0.82)",
    dark: "#050505",
  },
  gold: "#FFD700",
}
```

## 核心组件清单

### Foundation 组件
| 组件 | 文件路径 | 用途 | 复杂度 |
|------|---------|------|--------|
| `MatrixShell` | `ui/foundation/MatrixShell.jsx` | 页面外壳布局 | 高 |
| `MatrixButton` | `ui/foundation/MatrixButton.jsx` | 按钮组件 | 中 |
| `MatrixAvatar` | `ui/foundation/MatrixAvatar.jsx` | 头像组件 | 低 |
| `MatrixInput` | `ui/foundation/MatrixInput.jsx` | 输入框 | 中 |
| `AsciiBox` | `ui/foundation/AsciiBox.jsx` | ASCII 风格卡片 | 中 |
| `SignalBox` | `ui/foundation/SignalBox.jsx` | 信号/状态框 | 低 |
| `ScrambleText` | `ui/foundation/ScrambleText.jsx` | 文字扰乱动画 | 中 |
| `DecodingText` | `ui/foundation/DecodingText.jsx` | 解码动画文字 | 中 |

### Matrix-A 视图组件
| 组件 | 文件路径 | 用途 | 复杂度 |
|------|---------|------|--------|
| `DashboardView` | `ui/matrix-a/views/DashboardView.jsx` | 主仪表板视图 | 极高 |
| `LandingView` | `ui/matrix-a/views/LandingView.jsx` | 落地页视图 | 高 |
| `IdentityCard` | `ui/matrix-a/components/IdentityCard.jsx` | 用户身份卡片 | 中 |
| `UsagePanel` | `ui/matrix-a/components/UsagePanel.jsx` | 使用量面板 | 高 |
| `RollingUsagePanel` | `ui/matrix-a/components/RollingUsagePanel.jsx` | 滚动使用量 | 中 |
| `TopModelsPanel` | `ui/matrix-a/components/TopModelsPanel.jsx` | 模型排行 | 中 |
| `TrendMonitor` | `ui/matrix-a/components/TrendMonitor.jsx` | 趋势图表 | 高 |
| `ActivityHeatmap` | `ui/matrix-a/components/ActivityHeatmap.jsx` | 活动热力图 | 高 |
| `NeuralDivergenceMap` | `ui/matrix-a/components/NeuralDivergenceMap.jsx` | 模型使用分布 | 高 |
| `CostAnalysisModal` | `ui/matrix-a/components/CostAnalysisModal.jsx` | 成本分析弹窗 | 中 |
| `MatrixRain` | `ui/matrix-a/components/MatrixRain.jsx` | 背景矩阵雨 | 中 |
| `BootScreen` | `ui/matrix-a/components/BootScreen.jsx` | 启动屏幕 | 低 |

## 组件映射表 (旧 → 新)

| 旧组件 | 新组件 | 改动程度 |
|--------|--------|---------|
| `MatrixShell` | `Shell` / `AppShell` | 完全重写 |
| `MatrixButton` | `Button` | 完全重写 |
| `AsciiBox` | `Card` | 完全重写 |
| `SignalBox` | `StatusBadge` | 完全重写 |
| `MatrixInput` | `Input` | 完全重写 |
| `IdentityCard` | `IdentityCard` | 保留结构，重写样式 |
| `UsagePanel` | `UsagePanel` | 保留逻辑，重写样式 |
| `TrendMonitor` | `TrendMonitor` | 保留逻辑，重写图表样式 |
| `ActivityHeatmap` | `ActivityHeatmap` | 保留逻辑，重写颜色 |
| `MatrixRain` | 移除 | 删除 |
| `ScrambleText` | 可选保留 | 弱化效果 |
| `DecodingText` | 可选保留 | 弱化效果 |

## 需要重设计的优先级

### P0 - 核心基础
1. `styles.css` - 设计 token 系统
2. `tailwind.config.cjs` - 颜色/字体配置
3. `MatrixShell` → 新的 Shell
4. `MatrixButton` → 新的 Button
5. `AsciiBox` → 新的 Card

### P1 - 主要组件
6. `IdentityCard`
7. `UsagePanel`
8. `DashboardView` 布局更新

### P2 - 次要组件
9. `TrendMonitor` 图表样式
10. `ActivityHeatmap` 颜色更新
11. `TopModelsPanel`
12. `RollingUsagePanel`

### P3 - 移除
13. `MatrixRain` - 背景动画
