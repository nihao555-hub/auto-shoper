# Alibaba.com 批量上品流程与 ICBU API 对照

调研时间：2026-07-10。结论基于 Alibaba.com Seller Central、阿里开放平台公开文档和新版 GOP 调用示例。应用控制台中实际授权的方法、参数和限流规则仍是最终依据。

## 结论

- Alibaba.com 官方卖家后台支持逐条发布和 Bulk Upload，Intelligent Posting 会给出优化建议。
- ICBU OpenAPI 能覆盖自动上品的核心闭环，但公开资料没有证明存在“单次提交 100 个商品”的原生发布接口。本项目的批量接口是受控并发地逐条调用发布 API。
- 当前后端已实现类目、Schema 解析/填值/提交前复验、AI 文案和参考图生图、图片银行、草稿、回读、确认发布、商品查询、质量分、库存和上下架的主链路。
- 当前实现仍不能称为“完美满足生产全流程”。真实店铺还必须验证图片上传和草稿写入权限、完整 SKU/价格/物流样例、审核状态、限流、幂等和 OAuth 刷新。

## 官方完整流程

### 1. 授权与发布准备

1. 商家完成企业和店铺认证。
2. 应用通过 OAuth 获取 `access_token` 和 `refresh_token`。
3. 核对应用是否已获得类目、商品、图片银行、库存、上下架等接口权限。
4. 准备 ERP 或人工事实数据，不能由 AI 猜测价格、库存或合规信息。

### 2. 类目与动态 Schema

1. 从根类目开始逐级读取类目树。
2. AI 可以推荐类目，但商家必须确认最终叶子类目。
3. 调用 `alibaba.icbu.product.schema.get` 获取该类目当前的发布规则。
4. 按 Schema 的 `requiredRule`、类型、枚举、长度、正则和字段联动动态生成表单和校验，不能写死一套通用字段。

当前后端新增 `POST /api/v1/alibaba/schemas/parse`，可从官方 XML 中提取字段层级、`requiredRule`、`valueTypeRule`、枚举 `option`、复杂字段和需要人工确认的商业事实字段。

官方 Schema 文档明确要求先获取规则，再填充规则文件，最后调用发布接口。不同类目、商品类型和商家能力会改变必填项。

### 3. 商品素材和 AI 处理

1. 导入原始商品图片和已知商品资料。
2. AI 只提取可见事实，并生成标题、关键词、卖点、详情结构和场景图。
3. 生图只能改变背景、构图和展示方式，不能改变商品结构、数量、材质、认证或配件。
4. 商家确认 AI 提取结果。
5. 将最终图片上传图片银行，发布时使用返回的图片 ID 和平台 URL。
6. 如要提高 Product Information Score，还应提供视频、详细描述和真实认证资料。

### 4. 填写完整商品数据

最终字段以实时 Schema 为准，常见字段组包括：

- 基础信息：标题、最多 3 个关键词、叶子类目、商品分组、商品类型。
- 类目属性：品牌、型号、材质、颜色、规格等动态属性。
- 图片和视频：主图、附图、详情图、视频银行素材。
- SKU：销售属性、SKU 组合、商家 SKU、SKU 图片、SKU 价格和 SKU 库存。
- 价格交易：询盘品或 RTS、FOB/阶梯价/SKU 价、币种、单位、MOQ、样品规则。
- 履约物流：交期阶梯、包装说明、单件毛重、包装尺寸、物流属性、运费模板。
- 定制与服务：轻定制、深度定制、售后和保障模板。
- 合规资料：认证、专利、商标、原产地等真实证明。
- 详情内容：结构化详情或 HTML 详情，引用图片银行素材。

字段之间存在联动。例如使用 SKU 价时必须同步提交销售属性和 SKU；半托管商品还要求确定性价格、有效库存、箱规、重量尺寸和可计算的运费模板。

### 5. 草稿、预览和正式发布

1. 本地执行事实来源校验和实时 Schema 校验。
2. 调用草稿接口，保存单个商品草稿。
3. 使用草稿接口返回的商品 ID 和类目 ID 回读渲染结果。
4. 人工检查图片、标题、属性、SKU、价格、MOQ、库存、包装、物流、认证和详情。
5. 只有用户显式确认后，才调用正式发布接口。
6. 记录每条商品的请求引用、草稿 ID、商品 ID、错误码和 `trace_id`。

### 6. 发布后闭环

1. 查询商品详情或商品列表，确认商品 ID 和发布状态。
2. 等待平台审核；审核失败时保存原因并回到草稿修正。
3. 查询商品质量分，针对缺少的真实信息继续优化。
4. ERP 持续同步 SKU 库存。
5. 按业务规则执行上下架。
6. 商品变更使用增量更新，并遵守价格、SKU 和详情字段的联动规则。

## API 能力与当前实现

| 阶段 | 新版 GOP 操作 | 当前后端 | 状态 |
| --- | --- | --- | --- |
| 类目 | `/icbu/product/category/get` | `GET /api/v1/alibaba/categories/{category_id}` | 已封装；叶子类目仍需人工确认 |
| 发布 Schema | `/alibaba/icbu/product/schema/get` | `GET /api/v1/alibaba/categories/{category_id}/schema` | 已封装 |
| Schema 解析 | 本地解析 `schema.get` XML | `POST /api/v1/alibaba/schemas/parse` | 已实现；提取必填、枚举、复杂字段和人工确认字段 |
| Schema 填值 | 本地写入实时 Schema XML | `POST /api/v1/alibaba/schemas/build` | 已实现；支持标量、多值、复合、多复合和值属性，返回字段级错误 |
| 官方流程清单 | 后台 Bulk Upload/Posting 流程 | `GET /api/v1/alibaba/listing-flow` | 已实现；用于前端/任务编排对标 |
| 官方字段校验 | 本地校验 + Schema 规则 | `POST /api/v1/products/official-listing/validate` | 已实现；合并动态必填项和 AI 字段边界 |
| 字段来源矩阵 | 店铺默认值 + 单品资料 | `GET /api/v1/alibaba/listing-field-matrix` | 已实现；按全店/单品和 AI 辅助/可信来源分为四组 |
| 安全 XML 准备 | 本地来源门禁 + Schema 填值 | `POST /api/v1/products/official-listing/prepare` | 已实现；只继承白名单店铺默认值，AI 候选必须转为用户确认 |
| 安全草稿 | 逐商品来源校验后调用草稿接口 | `POST /api/v1/products/official-listing/drafts` | 已实现；服务端从带来源字段构建 XML |
| 安全批量草稿 | 逐商品来源校验后调用草稿接口 | `POST /api/v1/products/official-listing/batch/drafts` | 已实现；最多 100 条、顺序保持、失败隔离 |
| 安全正式发布 | 来源门禁 + 显式确认 | `POST /api/v1/products/official-listing/publish` | 已实现；AI/图片提取值不能绕过确认 |
| 安全批量发布 | 逐商品来源门禁 + 显式确认 | `POST /api/v1/products/official-listing/batch/publish` | 已实现；最多 100 条、失败隔离 |
| 图片银行分组 | `/icbu/product/photobank/group/list` | `GET /api/v1/alibaba/photo-bank/groups` | 已封装 |
| 图片银行查询 | `/icbu/product/photobank/list` | `GET /api/v1/alibaba/photo-bank/images` | 已封装 |
| 图片银行上传 | `/alibaba/icbu/photobank/upload` | `POST /api/v1/alibaba/photo-bank/images` | 已封装 |
| 草稿 | `/icbu/product/schema/add/draft` | `POST /api/v1/alibaba/products/drafts` | 已封装 |
| 批量草稿 | 逐条调用草稿接口 | `POST /api/v1/alibaba/products/batch/drafts` | 服务端编排，最多 100 条 |
| 草稿回读 | `/icbu/product/schema/render/draft` | `POST /api/v1/alibaba/products/drafts/render` | 使用 GOP 草稿商品 `product_id`、`cat_id` 和 `language` |
| 正式发布 | `/icbu/product/schema/add` | `POST /api/v1/alibaba/products/publish` | 强制显式确认 |
| 批量发布 | 逐条调用发布接口 | `POST /api/v1/alibaba/products/batch/publish` | 服务端编排，最多 100 条、单条失败隔离 |
| 商品更新 | `/icbu/product/schema/update` | `PATCH /api/v1/alibaba/products/{product_id}/schema` | 已封装；发送 `xml/product_id/cat_id/language` |
| 商品详情 | `/icbu/product/get` | `GET /api/v1/alibaba/products/{product_id}` | 已封装 |
| 商品列表 | `/alibaba/icbu/product/list` | `GET /api/v1/alibaba/products` | 已封装 |
| 质量分 | `/icbu/product/score/get` | `GET /api/v1/alibaba/products/{product_id}/score` | 已封装 |
| 库存查询 | `/icbu/product/inventory/get` | `GET /api/v1/alibaba/products/{product_id}/inventory` | 已封装 |
| 库存更新 | `/icbu/product/inventory/update` | `PUT /api/v1/alibaba/products/{product_id}/inventory` | 已封装；只接受业务事实 |
| 上下架 | `/icbu/product/update/display` | `PATCH /api/v1/alibaba/products/{product_id}/display` | 已封装 |

## 仍需补齐或真实验证

### 上线前阻塞项

1. 以专用测试商品验证图片上传、草稿创建和草稿回读，不修改现有商品。
2. 保存并自动刷新 OAuth token，处理失效和重新授权。
3. 完成 SKU、阶梯价、RTS/询盘品、包装、运费模板和合规资料的真实类目样例。
4. 发布后轮询审核状态，并支持失败修正和重新提交。
5. 增加限流退避、持久化幂等键、断点续传、任务状态、操作审计和失败重试。

### 提升商品质量的非核心项

- 视频银行上传和关联。
- 商品分组创建和管理。
- 认证资料和服务模板的专用管理。
- 基于质量分的优化建议与再次提交。
- 批量任务进度、暂停、恢复和导出失败报告。

## AI 字段边界

### 可以自动生成

- 英文标题的语序和表达。
- 最多 3 个关键词的组合建议。
- 卖点文案和详情页结构。
- 场景图、背景和排版提示词。
- 已知参数的多语言改写。

这些字段在 API 中仍标记为 `ai_generated`，只有用户确认后改为
`user_confirmed` 才能进入官方安全草稿或发布接口。

### 可从图片提取，但必须带置信度

- 可见颜色、花纹、形状、件数。
- 图片中清晰可读的品牌或型号。
- 可见结构和配件。
- 产品大类建议。

图片无法确认时必须留空。

### 必须由人工或业务系统提供

- 最终叶子类目。
- 价格、阶梯价、MOQ、币种和单位。
- SKU、型号和库存。
- 精确材质、成分、尺寸、重量和包装参数。
- 认证、专利、商标和合规声明。
- 原产地、港口、HS Code、产能、交期和物流。
- 定制能力、售后条款和服务限制。

全店通用的币种、计量单位、仓库、库存地点、图片银行分组、商品分组和运费模板
可以保存为 `account_default`。白名单以外的字段不能使用店铺默认来源；价格、SKU、
库存、材质、尺寸、重量、包装、交期和合规资料始终按单品校验。

## 公开依据

- [Alibaba.com Seller Central：可逐条发布或使用 Bulk Upload](https://seller.alibaba.com/how-to-sell)
- [Alibaba.com：How to post your products](https://seller.alibaba.com/learningcenter/content/detail/PX67BO9L.htm)
- [Alibaba.com：Product Tools](https://seller.alibaba.com/pages/producttools/index.html)
- [阿里开放平台：商品发布接入文档](https://open.alitrip.com/docs/doc.htm?articleId=119213&docType=1&treeId=456)
- [阿里开放平台：商品接口变动说明](https://open.alitrip.com/docs/doc.htm?articleId=119212&docType=1&treeId=456)
- [阿里开放平台：Schema 获取](https://developer.alibaba.com/doc2/apiDetail.htm?apiId=50063)
- [阿里开放平台：草稿回读](https://open.alitrip.com/docs/api.htm?apiId=50205)
- [阿里开放平台：增量更新](https://open.alitrip.com/docs/api.htm?apiId=50189)
- [阿里开放平台：图片银行上传](https://api.alidayu.com/docs/api.htm?apiId=24463)
- [阿里开放平台：商品列表](https://developer.alibaba.com/docs/api.htm?apiId=25438)
- [阿里开放平台：商品质量分](https://doc.alidayu.com/docs/api.htm?apiId=47461)
- [阿里开放平台：批量上下架](https://open.alitrip.com/docs/api.htm?apiId=44413)

公开文档同时存在旧 TOP 方法名和新版 GOP 路径。当前代码按用户提供的海外 GOP 网关实现；真实联调时必须以应用控制台展示的文档为准。
