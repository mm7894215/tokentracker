# OpenAI Design System 设计规范

> 基于 OpenAI 2024/2025 品牌更新及官方设计指南
> 研究日期: 2026-03-18

---

## 概述

OpenAI 于 **2024-2025 年**进行了重大品牌重塑，这是 OpenAI 自 2022 年以来的首次品牌更新。

### 核心团队
- **设计领导**: Veit Moeller (Head of Design), Shannon Jager (Design Director)
- **动态设计**: Studio Dumbar/Dept (Rotterdam)
- **字体设计**: ABC Dinamo (Berlin-based type foundry)

### 设计哲学转变
从纯粹的极简黑白"科技"美学转变为更加细致的系统，平衡:
- **技术权威性** (Technical Authority)
- **人性温度** (Human Warmth)
- **可扩展性** (Scalability)
- **有机开放感** (Organic & Open)

### 品牌关键词
有机 (Organic) | 人文 (Human) | 极简 (Minimal) | 精确 (Precise) | 开放 (Open) | 可能 (Possible)

---

## 颜色系统 (Color System)

### 主色 (Primary Colors)

| 颜色名称 | Token | 值 | RGB | 用途 |
|---------|-------|-----|-----|------|
| **Cod Gray** (近黑色) | `--oai-black` | `#080808` | 8, 8, 8 | 主深色背景、主文字颜色 |
| **White** (纯白) | `--oai-white` | `#FFFFFF` | 255, 255, 255 | 主背景色、深色背景上的文字 |
| **Black** (纯黑) | `--oai-pure-black` | `#000000` | 0, 0, 0 | 品牌黑色、强调元素 |

### 中性灰度 (Neutral Grays)
| Token | 值 | RGB | 用途 |
|-------|-----|-----|------|
| `--oai-gray-950` | `#0D0D0D` | 13, 13, 13 | 深色背景 |
| `--oai-gray-900` | `#171717` | 23, 23, 23 | 次要深色背景 |
| `--oai-gray-850` | `#202123` | 32, 33, 35 | 深色表面 (Slate) |
| `--oai-gray-800` | `#262626` | 38, 38, 38 | 卡片深色背景 |
| `--oai-gray-750` | `#40434A` | 64, 67, 74 | 图标、描边 (Graphite) |
| `--oai-gray-700` | `#404040` | 64, 64, 64 | 边框、分隔线 |
| `--oai-gray-600` | `#525252` | 82, 82, 82 | 次要文字 |
| `--oai-gray-500` | `#737373` | 115, 115, 115 | 占位符文字 |
| `--oai-gray-400` | `#A3A3A3` | 163, 163, 163 | 禁用状态 |
| `--oai-gray-300` | `#9EA1AA` | 158, 161, 170 | Steel (钢灰色) |
| `--oai-gray-200` | `#D4D4D4` | 212, 212, 212 | 浅色边框 |
| `--oai-gray-150` | `#E5E5E5` | 229, 229, 229 | 浅色背景 |
| `--oai-gray-100` | `#F5F5F5` | 245, 245, 245 | 近白色背景 |
| `--oai-gray-75` | `#F5F7FA` | 245, 247, 250 | Mist (雾灰) |
| `--oai-gray-50` | `#FAFAFA` | 250, 250, 250 | 最浅背景 |

### 语义色 (Semantic Colors)
| Token | 值 | RGB | 用途 |
|-------|-----|-----|------|
| `--oai-success` | `#10B981` | 16, 185, 129 | 成功状态 |
| `--oai-warning` | `#F59E0B` | 245, 158, 11 | 警告状态 |
| `--oai-error` | `#EF4444` | 239, 68, 68 | 错误状态 |
| `--oai-info` | `#3B82F6` | 59, 130, 246 | 信息提示 |

### 2025 品牌更新色彩方向
根据 2025 年品牌重塑:
- **基础色调**: 灰色和蓝色系（代表"地平线、开放空间和广阔可能性"）
- **对比色**: 鲜明的主色调用于强调和视觉清晰度
- **动态元素**: 蓝色脉动圆盘 (Emotive Point) 代表 ChatGPT 的"声音"
- **色彩心理学**: 高对比度极简主义（Cod Gray/白色）创造专注、整洁的数字空间

### OpenAI 品牌色 (OpenAI Brand Colors)

| 颜色名称 | Token | 值 | RGB | 用途 |
|---------|-------|-----|-----|------|
| **OpenAI Green** (品牌绿) | `--oai-brand-green` | `#10A37F` | 16, 163, 127 | 主要 CTA 按钮、品牌标识、成功状态 |
| **Azure** (天蓝色) | `--oai-azure` | `#2B8FFF` | 43, 143, 255 | 次要强调色、链接、交互元素 |

### 现代强调色 (2025 Refresh)
| Token | 值 | RGB | 用途 |
|-------|-----|-----|------|
| `--oai-blue` | `#3B82F6` | 59, 130, 246 | 主强调色、按钮、链接 |
| `--oai-blue-dark` | `#2563EB` | 37, 99, 235 | 按钮悬停状态 |
| `--oai-blue-light` | `#60A5FA` | 96, 165, 250 | 悬停高亮 |
| `--oai-emotive-blue` | *动态* | *脉动蓝* | Emotive Point 动态元素 |

### 语义色
| Token | 值 | 用途 |
|-------|-----|------|
| `--oai-success` | `#10B981` | 成功状态 |
| `--oai-warning` | `#F59E0B` | 警告状态 |
| `--oai-error` | `#EF4444` | 错误状态 |
| `--oai-info` | `#3B82F6` | 信息提示 |

---

## 字体系统 (Typography System)

### 主字体: OpenAI Sans

**OpenAI Sans** (定制字体)
- **设计者**: ABC Dinamo (柏林字体铸造厂)
- **设计哲学**:
  - 几何精确度与人文温暖的结合
  - 避免过于机械的外观
  - 融入 "The Point"（圆点）品牌元素到字母形态中
- **替代**: 替代之前使用的 6-7 种不同字体
- **未来计划**: 全球文字系统、等宽版本 (Monospace) 开发中
- **特点**: 被描述为"给排版的情书"

### 字体栈 (Font Stack)
```css
--oai-font-sans: 'OpenAI Sans', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Arial, sans-serif;
--oai-font-mono: 'IBM Plex Mono', 'SF Mono', SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace;
```

### 备用字体

| 用途 | 字体家族 | 回退字体 |
|------|---------|---------|
| **标题** | Inter (SemiBold/Bold, 24px+) | Arial, sans-serif |
| **正文** | Inter (Regular) | Arial, sans-serif |
| **代码/等宽** | IBM Plex Mono | Menlo, monospace |
| **平台原生** | SF Pro (iOS) | - |
| **平台原生** | Roboto (Android) | - |

### 字号层级
| Token | 大小 | 行高 | 字重 | 字间距 | 用途 |
|-------|------|------|------|--------|------|
| `--text-hero` | 48px | 1.1 | 600 | -0.02em | 页面标题 |
| `--text-h1` | 36px | 1.2 | 600 | -0.02em | 一级标题 |
| `--text-h2` | 28px | 1.25 | 600 | -0.01em | 二级标题 |
| `--text-h3` | 22px | 1.3 | 600 | -0.01em | 三级标题 |
| `--text-h4` | 18px | 1.4 | 600 | 0 | 四级标题 |
| `--text-body` | 16px | 1.5 | 400 | 0 | 正文 |
| `--text-body-sm` | 14px | 1.5 | 400 | 0 | 小正文 |
| `--text-caption` | 12px | 1.4 | 500 | 0.01em | 说明文字 |
| `--text-label` | 11px | 1.3 | 600 | 0.02em | 标签（大写） |

---

## 间距系统

### 基础单位: 4px
| Token | 值 |
|-------|-----|
| `--space-0` | 0 |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |
| `--space-16` | 64px |
| `--space-20` | 80px |

### 圆角
| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | 4px | 小按钮、标签 |
| `--radius-md` | 8px | 按钮、输入框 |
| `--radius-lg` | 12px | 卡片 |
| `--radius-xl` | 16px | 大卡片、模态框 |
| `--radius-full` | 9999px | 圆形、胶囊形 |

---

## 组件规范

### 按钮

**主按钮 (Primary)**
- 背景: `--oai-blue` (#3B82F6)
- 文字: `--oai-white`
- 边框: none
- 圆角: `--radius-md` (8px)
- 高度: 40px (标准) / 36px (小)
- 内边距: 0 16px
- 字体: 14px, 字重 500
- 悬停: `--oai-blue-dark` (#2563EB)

**次按钮 (Secondary)**
- 背景: transparent
- 文字: `--oai-white`
- 边框: 1px solid `--oai-gray-700`
- 圆角: `--radius-md`
- 悬停: 背景 `--oai-gray-800`

**幽灵按钮 (Ghost)**
- 背景: transparent
- 文字: `--oai-gray-300`
- 无边框
- 悬停: 文字 `--oai-white`

### 卡片

**标准卡片**
- 背景: `--oai-gray-900` (#171717)
- 边框: 1px solid `--oai-gray-800`
- 圆角: `--radius-lg` (12px)
- 内边距: 24px
- 阴影: none (扁平化设计)

**强调卡片**
- 背景: `--oai-gray-800`
- 边框: 1px solid `--oai-gray-700`

### 输入框

**标准输入框**
- 背景: `--oai-gray-900`
- 边框: 1px solid `--oai-gray-700`
- 圆角: `--radius-md`
- 高度: 40px
- 内边距: 0 12px
- 字体: 14px
- 占位符: `--oai-gray-500`
- 聚焦: 边框 `--oai-blue`

---

## 视觉元素 (Visual Elements)

### "The Point" (品牌核心元素)
- **描述**: 黑色圆形符号，代表光标/ChatGPT 回应的起点
- **用途**: 品牌网格、字体和设计元素的基础
- **象征**: AI 的客观性、非人类但亲和的视觉提示
- **设计**: 融入 OpenAI Sans 字体的字母形态中

### Emotive Point (动态元素)
- **描述**: 脉动的蓝色圆盘
- **背景**: 水彩风格的 swirling blue 抽象形式
- **代表**: ChatGPT 的"声音"
- **设计意图**: 故意保持非人类和中性，代表 AI 的客观性
- **动态**: 由 Studio Dumbar/Dept 开发的运动识别系统

### 设计 Token 总结

```css
/* 颜色 Token */
--color-primary-black: #080808;
--color-primary-white: #FFFFFF;
--color-pure-black: #000000;
--color-accent-green: #10A37F;
--color-accent-azure: #2B8FFF;
--color-blue-primary: #3B82F6;
--color-blue-dark: #2563EB;
--color-blue-light: #60A5FA;

/* 字体 Token */
--font-family-primary: "OpenAI Sans", Inter, Arial, sans-serif;
--font-family-mono: "IBM Plex Mono", Menlo, monospace;
--font-weight-regular: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: 700;

/* 间距 Token */
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
--spacing-xl: 32px;
--spacing-2xl: 48px;
--spacing-3xl: 64px;

/* 圆角 Token */
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-full: 9999px;
```

---

## 布局原则

### 容器
- 最大宽度: 1200px
- 侧边内边距: 24px (桌面) / 16px (移动)

### 网格
- 使用 12 列网格系统
- 列间距: 24px (桌面) / 16px (移动)

### 响应式断点
| 断点 | 宽度 | 说明 |
|------|------|------|
| `sm` | 640px | 手机横屏 |
| `md` | 768px | 平板 |
| `lg` | 1024px | 小桌面 |
| `xl` | 1280px | 桌面 |
| `2xl` | 1536px | 大桌面 |

---

## 设计原则

1. **极简主义**: 保持界面简洁，去除多余装饰
2. **高对比度**: 使用深色背景配浅色文字，确保可读性
3. **一致性**: 使用统一的设计 token 保持全局一致
4. **层次清晰**: 通过颜色、字号、间距建立清晰的视觉层次
5. **反馈及时**: 交互元素有明确的悬停、点击状态

---

## 与 Matrix 主题的主要区别

| 方面 | Matrix (旧) | OpenAI (新) |
|------|-------------|-------------|
| 主色调 | 绿色 #00FF41 | 蓝色 #3B82F6 |
| 背景 | 黑色 #050505 | 深灰 #080808 |
| 字体 | Geist Mono (等宽) | OpenAI Sans (无衬线) |
| 边框 | 发光绿色边框 | 灰色细边框 |
| 风格 | 赛博朋克/终端 | 极简专业 |
| 动效 | 扫描线、矩阵雨 | 微妙过渡 |

---

## 可访问性标准 (Accessibility)

### 对比度要求
- **最低标准**: WCAG AA 对比度比例
- **文本对比**: 4.5:1 对比度
- **大文本对比**: 3:1 对比度

### 其他要求
- 支持文本缩放而不破坏布局
- 语义化 HTML 和 ARIA 属性
- 所有图片提供 alt 文本
- 支持文本调整大小
- 最低字重 400 (Regular) 确保可读性

---

## 参考资源

### 官方资源
- [OpenAI Brand Portal](https://openai.com/brand/) - 官方品牌指南
- [OpenAI Apps SDK UI Guidelines](https://developers.openai.com/apps-sdk/concepts/ui-guidelines/) - 开发者 UI 规范

### 第三方分析
- [Lumina Design System Exploration](https://www.redrivera.design/creating-lumina) - 社区设计系统分析
- [Font of Web - OpenAI Tokens](https://fontofweb.com/tokens/openai.com) - 提取的设计 token (285 品牌色, 67 字体样式)
- [Mobbin - OpenAI Brand Colors](https://mobbin.com/colors/brand/openai) - 品牌颜色值

### 品牌更新报道
- [Creative Review - OpenAI Brand Refresh](https://www.creativereview.co.uk/openai-brand-refresh/)
- [DesignRush - OpenAI Refreshes Visual Identity](https://www.designrush.com/news/openai-refreshes-its-visual-brand-identity-with-new-logo-typeface)
- [URDesignMag - OpenAI Rebrand](https://www.urdesignmag.com/openai-rebrand-chatgpt-sora-ai-revolution/)

---

*来源: OpenAI Brand Guidelines (openai.com/brand), Studio Dumbar/Dept, ABC Dinamo*
*研究日期: 2026-03-18*
