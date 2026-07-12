# 上品台前端设计系统

## Design Read

面向 Alibaba.com 商家的 B2B 发品工作台。界面需要可信、克制、高效，采用暖色编辑式极简风格，优先保证信息层级和批量操作效率。

设计参数：

- Design variance: 5
- Motion intensity: 3
- Visual density: 6

## 信息架构

第一版包含四个工作区主页面：

1. 运营总览：展示当前批次、草稿、异常项和发布准备。
2. 店铺授权：添加、同步和切换多个 Alibaba 店铺，查看授权有效期、权限健康度和草稿就绪状态。
3. 批量上品工作台：在一个页面内完成上传、AI 生成、补齐事实、创建草稿、预览发布。
4. 批次记录：继续未完成批次、处理失败项、查看发布结果。

店铺授权是侧边栏一级入口。商家资产与批次偏好使用右侧抽屉；商品复杂字段使用右侧检查器，不拆分类目、SKU、包装等独立页面。

## 视觉语言

- Canvas: `#f5f2ea`
- Surface: `#fffefa`
- Ink: `#191915`
- Muted ink: `#716f68`
- Hairline: `#dedbd2`
- Brand accent: `#e95c32`
- AI candidate: `#eee8ff` / `#6750a4`
- Account default: `#e7f0ff` / `#2e63a6`
- Trusted fact: `#e8f3e9` / `#2f6b3c`
- Missing or invalid: `#fde9e5` / `#ad3c2d`

不使用渐变、玻璃拟态、厚重阴影、大面积高饱和背景或无意义状态点。

## 字体与尺寸

- UI Latin: Manrope Variable
- CJK fallback: PingFang SC, Microsoft YaHei, Noto Sans CJK SC
- Display: 28-34px / 700
- Section title: 18-22px / 650
- Body: 14px / 450
- Metadata: 12px / 500

界面采用 4px 基础网格。主要间距为 8、12、16、20、24、32px。

## 布局

- Desktop navigation rail: 196px；可折叠至 76px
- Header: 96-104px
- Workbench: table 68%, inspector 32%
- Inspector: 360-440px
- Bottom action bar: 76px
- Table row: 64px
- Content max width: none; operational UI uses available viewport

小于 1100px 时检查器变为覆盖式抽屉；小于 760px 时导航变为底部栏、表格变为商品列表、步骤条可横向滚动。

## 交互规则

- 用户首先看到“AI 已完成多少、仍需确认和填写多少”，而不是全部字段。
- 已有店铺默认值的字段折叠隐藏，用户可展开查看来源。
- AI 字段使用紫色来源标记，点击一次可确认当前商品全部 AI 候选。
- 价格、库存、SKU、尺寸、重量和合规资料始终显示可信来源要求。
- 正式发布必须经过草稿回读、商品勾选和二次确认。
- 单商品失败不阻止其他商品继续。
- 所有按钮、菜单、抽屉和表格操作支持键盘；焦点样式不可移除。
- 动画只用于抽屉、步骤切换、Toast 和 hover，遵守 `prefers-reduced-motion`。

## 参考图分析

### 工作台

- 76px 侧栏和 72px 顶栏建立稳定框架。
- 五步流程占据顶部第二行，当前步骤只使用一条橙色强调线。
- 主体是平面表格，不把每一行做成卡片。
- 右侧检查器按基础信息、SKU 定价、包装物流、合规分组。
- 底部汇总和主要动作始终可见。

### 批次记录

- 筛选、搜索和列表位于同一平面。
- 异常批次使用淡红整行背景，不依赖弹窗或图表。
- 周进度只展示四个大数字，避免仪表盘式图表噪音。

### 店铺授权

- 添加店铺只启动 Alibaba 官方 OAuth，不读取商家密码。
- 每个店铺集中显示账号、授权期限、权限健康度、同步状态和草稿就绪状态。
- 当前店铺使用左侧橙色细线和暖色底提示，不使用整卡高饱和背景。
- 过期状态以弱化内容和局部淡红提示表达，不使用整卡警报色。
- 切换店铺后刷新店铺级查询，已创建批次仍锁定原店铺。

### 商家资产抽屉

- 560px 宽度，可容纳双列表单。
- 左侧分组索引，右侧当前分组内容。
- 不允许设为默认值的字段使用单一警告区说明。
- 底部固定保存动作和配置完整度。

## Pre-flight

- 页面和文案中不使用 em dash 字符。
- 不使用 Inter、Roboto、Arial、Open Sans。
- 不使用装饰性渐变、嵌套卡片或大圆角胶囊。
- 状态颜色只传达真实语义。
- 触控目标至少 40px。
- 对比度、焦点、标签、空状态、加载态、错误态和移动端均需覆盖。

## GPT Image2 设计稿

`docs/ui-design/00-design-system.png` 是唯一视觉母版。认证、总览、店铺授权、批量上品和批次记录设计稿均通过 GPT Image2 的图片编辑接口生成，并将母版图片作为参考图上传。画面中的批注同时约束前端实现与 UI 设计。
