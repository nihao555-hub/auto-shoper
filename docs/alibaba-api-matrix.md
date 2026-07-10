# Alibaba.com ICBU API 调研

## 推荐的自动上品链路

| 阶段 | API | 用途 | 自动化策略 |
| --- | --- | --- | --- |
| 类目 | `alibaba.icbu.category.get.new` / `/icbu/product/category/get` | 获取类目树和叶子类目 | AI 可推荐，必须人工确认 |
| 发布规则 | `alibaba.icbu.product.schema.get` / `/alibaba/icbu/product/schema/get` | 获取类目动态字段、必填规则和枚举 | 全自动读取，禁止写死类目字段 |
| 图片 | `alibaba.icbu.photobank.upload` / `/alibaba/icbu/photobank/upload` | 上传图片银行并取得平台图片 URL | 可自动上传 |
| 草稿 | `alibaba.icbu.product.schema.add.draft` / `/icbu/product/schema/add/draft` | 保存商品草稿 | 自动保存，人工复核 |
| 草稿回读 | `alibaba.icbu.product.schema.render.draft` / `/icbu/product/schema/render/draft` | 回读草稿和规则 | 自动校验 |
| 发布 | `alibaba.icbu.product.schema.add` / `/icbu/product/schema/add` | 正式发布商品 | 必须人工显式确认 |
| 更新 | `alibaba.icbu.product.schema.update` / `/icbu/product/schema/update` | 增量更新已发布商品 | 事实字段变更需人工确认 |
| 查询 | `alibaba.icbu.product.get` / `/icbu/product/get` | 查询单个商品 | 全自动 |
| 列表 | `alibaba.icbu.product.list` / `/alibaba/icbu/product/list` | 分页查询商品 | 全自动 |
| 质量分 | `alibaba.icbu.product.score.get` / `/icbu/product/score/get` | 查询商品质量分 | 全自动，可用于优化建议 |
| 库存 | `/icbu/product/inventory/get`、`/icbu/product/inventory/update` | 查询和更新 SKU 库存 | 查询自动；更新以 ERP 事实为准 |
| 上下架 | `/icbu/product/update/display`、批量上下架接口 | 控制在线状态 | 需要业务规则和操作审计 |

国际站存在旧 TOP 网关和较新的 GOP 网关两套调用形态。实际应用授权可能只开放其中一套，因此网关、方法名和 URL 拼接方式均做成配置，真实联调时以应用控制台已授权的 API 文档为准。

后端批量接口会把每批最多 100 条商品拆成受控并发请求。每条商品独立返回成功或失败，避免单条 Schema 校验错误中断整批；建议先批量保存草稿、回读校验，再由用户一次确认后批量发布。

## AI 可以处理的字段

### 可从图片提取，但需要置信度

- 可见颜色、花纹、形状、件数
- 图片中清晰可读的品牌或型号文字
- 产品大类建议
- 可见结构和配件

图片看不出来时必须返回空值，不能补全。

### 可生成，但不能创造商品事实

- 英文标题的语序和表达
- 搜索关键词组合
- 卖点文案和详情页结构
- 图片提示词、背景和排版建议
- 已知参数的多语言改写

### 必须人工或业务系统提供

- 最终叶子类目
- 价格、阶梯价、MOQ、币种
- SKU、型号、库存
- 精确材质、成分、工艺
- 尺寸、重量、包装参数
- 认证、专利、商标和合规声明
- 原产地、港口、HS Code
- 产能、交期、物流和售后条款
- 定制能力及其限制

## 验证状态

- 已核对官方文档中的 Schema 获取、草稿渲染、发布流程和图片银行依赖。
- 已用单元测试验证签名、参数序列化、人工确认门禁和错误处理。
- 真实店铺调用仍需要 Alibaba AppKey、AppSecret、AccessToken 及对应接口权限。
