# Alibaba.com 国际站官方自动发品流程对齐审计

审计日期：2026-07-11  
审计范围：PR #1 修复前基线、Alibaba 官方商品发布 Schema 文档、真实店铺只读/无效参数探测  
真实账户保护：未创建草稿、未发布、未更新库存、未上下架、未上传图片

## 结论

审计基线是一个安全门禁和批量编排原型，**尚未完全对齐 Alibaba 官方生产发品链路，不能直接用于真实发品**。

### 本轮修复进度

审计后已补齐以下项目：

- 修正 Schema 获取、草稿创建、正式发布、草稿回读、商品详情、库存、上下架和商品更新的真实 GOP 参数；
- 新增实时 Schema XML 填值器，支持 `<value>`、`<values>`、`<complex-value>`、`<complex-values>` 和值属性；
- 修正可选 `multiComplex` 子字段的必填传播，并执行枚举、长度、数值、正则、数量、只读和值属性校验；
- 草稿和正式发布前重新解析并验证已填 XML；
- 修正图片银行 multipart operation、参数和 `image_bytes` 文件字段；
- 增加参考商品图生图入口、商品一致性提示和强制人工确认；
- 严格校验模型结构化输出，删除 AI 返回的价格、材质、库存等业务事实；
- 修正顶层 GOP 错误和嵌套业务错误处理，保留 `trace_id`。

仍然阻止正式生产发布的项目：

- 使用专用测试商品完成真实图片上传、草稿创建和草稿回读；
- 由商家提供完整 SKU、价格、库存、包装和物流模板事实；
- 持久化幂等/批次审计、OAuth 刷新、限流退避和审核状态轮询；
- 当前 AI 网关余额不足，真实图片分析和参考图生图尚未验证。

基线已经对齐的部分：

- GOP HMAC-SHA256 签名和真实账户只读连接；
- 叶子类目详情查询；
- XML Schema 的字段树、基础必填规则、枚举和复合字段解析；
- AI 生成内容需要人工确认，价格、MOQ、库存等业务事实禁止由 AI 猜测；
- 批量任务限并发、保持顺序、单品失败隔离；
- 正式发布需要 `confirmed_by_user=true`。

基线中阻止真实发品的关键缺口：

1. 多个真实 API 的参数结构或 operation 不正确；
2. 没有把结构化商品资料写回 Alibaba Schema XML；
3. Schema 本地校验把可选复合字段的子字段误判为全局必填，并且未执行完整规则；
4. 图片上传不是 multipart，且 operation 错误；
5. 生图只有文生图，没有参考商品图和商品一致性约束；
6. OAuth 刷新、幂等、限流重试、审核状态轮询和发布审计不完整。

## 官方完整链路

### 1. OAuth 授权与店铺能力检查

- 商家授权应用，取得 access token 和 refresh token；
- 校验商品、类目、图片银行、库存和上下架接口权限；
- 管理 token 到期、刷新和撤销；
- 读取店铺现有商品或能力接口验证账号归属，不能用一次成功请求代替长期授权管理。

### 2. 选择最终叶子类目

- 获取类目树；
- AI 可以推荐类目；
- 最终叶子类目必须由用户确认；
- 类目决定后续所有动态字段和校验规则。

### 3. 实时获取并解析发布 Schema

调用 `alibaba.icbu.product.schema.get`，至少传：

```json
{
  "cat_id": 21111112,
  "language": "en_US"
}
```

官方 XML Schema 定义：

- `input`、`multiInput`、`singleCheck`、`multiCheck`；
- `complex`、`multiComplex`、`label`；
- `requiredRule`、`disableRule`、`readOnlyRule`；
- 长度、数值、数量、正则、图片尺寸、候选项；
- `valueAttributeRule` 和 `asyncQueryRule`；
- 类目属性、SKU、价格、履约和详情结构。

### 4. 素材准备与图片银行

- 收集原始商品图；
- AI 可以做抠图、背景替换、场景图、详情图和文案辅助，但必须保持商品外观、数量、颜色、结构及品牌信息一致；
- 主图、SKU 图和详情图先上传卖家图片银行；
- 使用图片银行返回的 `file_id` 和 `photobank_url` 填写 Schema；
- 官方明确要求发布/更新商品使用图片银行素材，不能把 `product.get` 返回的旧主图 URL 直接当作新发布素材。

### 5. 收集并确认完整商品事实

按实时 Schema 填写：

- 基础：标题、关键词、商品组、卖点、详情；
- 类目属性：品牌、型号、材质、颜色、规格、原产地等；
- SKU：销售属性组合、SKU 编码、SKU 图片、价格、仓库库存；
- 交易：销售类型、币种、计量单位、MOQ、阶梯价或 SKU 价、样品；
- 履约：交期阶梯、包装、重量、长宽高、物流属性、运费模板；
- 定制与服务；
- 认证、商标、专利、HS Code 和其他合规资料。

价格、MOQ、SKU、库存、材质、尺寸、重量、包装、认证、原产地和物流只能来自用户或业务系统。

### 6. 将数据填入官方 Schema XML

必须以 `schema.get` 返回的 XML 为真源，在对应 `<field>` 中写入：

- 单值：`<value>`；
- 多值：`<values><value>…</value></values>`；
- 复合值：`<complex-value><field>…</field></complex-value>`；
- 多复合值：多个 `<complex-value>`。

提交前执行 Schema 规则、SKU 组合、阶梯价顺序、价格/MOQ/库存和物流联动校验。

### 7. 创建草稿

真实 GOP 接口：

```text
operation: /icbu/product/schema/add/draft
parameter: param_product_top_publish_request
```

请求对象至少包含：

```json
{
  "language": "en_US",
  "cat_id": 21111112,
  "xml": "<itemSchema>…</itemSchema>"
}
```

成功返回的是草稿商品 `product_id`，不是自定义 `draft_id`。

### 8. 回读草稿并人工预览

调用 `/icbu/product/schema/render/draft`，传：

```json
{
  "language": "en_US",
  "cat_id": 21111112,
  "product_id": 123456789
}
```

人工检查图片、标题、属性、SKU、价格、MOQ、库存、包装物流、详情、认证和合规信息。

### 9. 明确确认后正式发布

真实 GOP 接口：

```text
operation: /icbu/product/schema/add
parameter: publish_request
```

请求对象同样至少包含 `language`、`cat_id` 和 `xml`。只有用户明确确认后才能调用；系统需要保存请求摘要、返回的 `product_id`、Alibaba `trace_id` 和单品结果。

### 10. 审核回查与发布后维护

- 查询商品详情、列表状态和质量分；
- 轮询审核状态并保存失败原因；
- 通过 Schema render/update 修改商品；
- 同步 SKU 库存；
- 批量上下架；
- 对限流、临时错误和 token 失效分类处理。

## 当前实现逐项对照

| 官方阶段 | 当前状态 | 主要证据或缺口 |
|---|---|---|
| OAuth 与能力 | 部分对齐 | 只有静态 access token；无 refresh token 流程、到期管理和按接口权限探测 |
| 类目 | 部分对齐 | 真实叶子类目查询成功；缺完整类目树/确认记录 |
| Schema 获取 | 未对齐 | 当前请求缺少真实接口必填的 `language` |
| Schema 解析 | 部分对齐 | 能解析 95,817-byte 真实 Schema、46 个顶层字段；但把可选复合字段的内部必填项错误展开为全局必填，真实样例误报 50 个必填字段 |
| Schema 规则校验 | 未对齐 | 未完整执行正则、长度、数值、数量、值属性、只读、禁用和异步层级属性规则 |
| Schema XML 填充 | 缺失 | 没有从商品事实生成 `<value>`、`<values>`、`<complex-value>` |
| AI 图像分析 | 部分对齐 | 有禁止猜测规则；模型 JSON 没有严格 schema 校验，字段没有映射到实时类目 Schema |
| AI 生图 | 未对齐 | 只有 `/images/generations` 文生图；无参考图、商品一致性校验、图片下载验证和批量素材角色 |
| 图片银行 | 未对齐 | 当前 operation `/icbu/product/photobank/upload` 无效；官方 GOP operation 为 `/alibaba/icbu/photobank/upload`，并要求 multipart `file`、`file_name`、`image_bytes` |
| 草稿创建 | 未对齐 | 当前发送 `cat_id/schema_data`；真实接口要求 `param_product_top_publish_request={language,cat_id,xml}` |
| 草稿回读 | 未对齐 | 当前使用 `draft_id`；真实接口要求草稿 `product_id`、`cat_id`、`language` |
| 正式发布 | 未对齐 | 当前发送 `cat_id/schema_data`；真实接口要求 `publish_request={language,cat_id,xml}` |
| 商品详情 | 未对齐 | 当前发送 `product_id`；真实接口要求 `product_get_request={productId}` |
| 库存 | 未对齐 | 真实更新接口要求 `product_id` 和 `inventory_list`；当前结构不同 |
| 上下架 | 未对齐 | 真实接口要求 `new_display` 和 `product_id_list`；当前结构不同 |
| Schema 更新 | 未对齐 | 真实接口要求 `xml`，不是当前的 `schema_id/schema_data` |
| 错误处理 | 未对齐 | Alibaba 顶层 `code != "0"` 或嵌套 `result.success=false` 目前可能被当作成功 |
| 批量编排与发布门禁 | 已对齐 | 限并发、顺序保持、失败隔离、未确认禁止发布已有测试 |
| 审核轮询、幂等、限流 | 缺失 | 不能安全处理生产批次重试和审核闭环 |

## 真实账户验证事实

以下调用成功且无写操作：

- 商品列表：账号共有 989 个商品；
- 叶子类目 `21111112`：`Paint Brushes`；
- 获取该类目实时 Schema：95,817 bytes；
- 渲染现有商品 Schema；
- 查询商品质量分、图片银行分组和库存。

无效参数探测确认：

- Schema 获取缺 `language` 时，Alibaba 返回 `MissingParameter`；
- 草稿接口要求 `param_product_top_publish_request`，内部依次要求 `language`、`cat_id`、`xml`；
- 发布接口要求 `publish_request`，内部依次要求 `language`、`cat_id`、`xml`；
- 草稿渲染要求 `product_id`，不是 `draft_id`；
- 图片上传当前 operation 返回 `InvalidApiPath`；
- 商品详情要求 `product_get_request.productId`；
- 库存更新要求 `product_id` 和 `inventory_list`；
- 上下架要求 `new_display` 和 `product_id_list`。

## 修复优先级

### P0：真实草稿前必须完成

1. 修复 Alibaba 请求 DTO、operation 和双层错误判断；
2. 实现以实时 XML 为真源的 Schema 值读写器；
3. 修正必填传播和完整规则校验；
4. 实现 multipart 图片银行上传及返回值校验；
5. 修正草稿创建、草稿 render、商品详情；
6. 添加幂等键、批次审计和真实 trace ID 记录；
7. 用一个专用测试商品只创建草稿并回读，不正式发布。

### P1：正式发布前必须完成

1. 参考图生图、商品一致性和人工选图；
2. SKU 组合、阶梯价、库存和物流模板联动；
3. OAuth 刷新和权限失效处理；
4. 审核状态轮询、质量分和失败原因闭环；
5. 正式发布前展示完整 diff 并再次确认。

### P2：规模化批量发布前完成

1. Alibaba 限流感知的重试和退避；
2. 可恢复批次、断点续跑和去重；
3. 批次报表、失败修复和重新提交；
4. 发布后库存同步、编辑和上下架策略。

## 官方参考

- 商品发布 Schema 接入文档：<https://open.alitrip.com/docs/doc.htm?articleId=119213&docType=1&treeId=456>
- Schema 获取：<https://developer.alibaba.com/doc2/apiDetail.htm?apiId=50063>
- 商品 Schema render：<https://developer.alibaba.com/docs/api.htm?apiId=50188>
- 草稿 Schema render：<https://open.alitrip.com/docs/api.htm?apiId=50205>
- 图片银行上传：<https://api.alidayu.com/docs/api.htm?apiId=24463>
- 图片银行查询：<https://open.alitrip.com/docs/api.htm?apiId=24459>
- 商品详情：<https://developer.alibaba.com/docs/api.htm?apiId=25439>
- 商品列表：<https://developer.alibaba.com/docs/api.htm?apiId=25438>
