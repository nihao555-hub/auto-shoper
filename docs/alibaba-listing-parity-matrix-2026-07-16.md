# 阿里国际站人工上品等效性审计矩阵

审计日期：2026-07-16

## 1. 审计结论

当前本地代码已经具备 Schema 驱动的通用上品主链路，但尚不能宣称与阿里国际站人工上品完全等效。

- 已验证阿里真实一级类目树可读取，共返回 50 个一级类目。
- 已从农业、服装、美妆、消费电子、医疗、包装印刷、办公用品、汽配 8 个行业读取真实叶子类目 Schema。
- 8 个样本共出现 161–170 个原始字段；字段类型均落在现有解析器支持的 7 类 Schema 组件内。
- 对水彩纸真实 Schema 的 46 个顶层组件逐项审计后：7 个属于平台状态、只读或结构字段；37 个 Schema 卖家字段组件已具备入口及提交结构；2 个视频组件已补充独立 TOP 查询、本地文件/公网 URL 上传、关联接口和前端视频库选择入口，但真实店铺权限与草稿关联结果尚未验收。
- 图片、SKU 箱规、主图顺序、图库编辑、条件字段和视频上传/选择/关联缺口已在本地修复，但尚未部署到生产环境。

因此当前状态为：**Schema 表单、图片链路及本地视频上传链路已完成本地实现；完整人工上品等效性仍被生产反向代理验收、TOP 视频生产权限、真实视频关联结果和多类目生产草稿回读验收阻断。**

## 2. 验证范围与证据

| 证据 | 验证内容 | 结果 |
|---|---|---|
| 线上 `/alibaba/categories/0/children` | 当前授权店铺真实一级类目树 | 50 个一级类目，成功 |
| 8 个真实叶子类目 `/schema` | 跨行业字段类型、规则、媒体组件 | 161–170 个原始字段/类目，成功解析 |
| 用户提供的水彩纸 Schema | 店铺箱规、运费模板、价格模式、SKU、媒体等完整实例 | 46 个顶层组件、162 个字段 |
| 本地 Schema guidance | 系统可展示、可校验字段 | 样本每类目约 104–113 个卖家任务字段 |
| 后端单元测试 | Schema 解析、条件价格、嵌套字段、SKU、箱规、严格草稿回读、TOP 发品资格/库存/上下架/视频协议、本地视频暂存和路由 | 200 项全量回归通过 |
| 前端生产构建 | TypeScript 与打包 | 本地通过 |

抽样叶子类目：

| 行业 | 叶子类目 ID | 叶子类目 | 原始字段数 |
|---|---:|---|---:|
| Agriculture | 138 | Agricultural Waste | 167 |
| Apparel & Accessories | 202222411 | Clothing Accessories | 163 |
| Beauty | 201268399 | Other Beauty & Personal Care Products | 170 |
| Consumer Electronics | 4499 | Other Consumer Electronics | 166 |
| Medical devices & Supplies | 201195002 | Other Veterinary Instrument | 168 |
| Packaging & Printing | 201268782 | Other Packaging & Printing Products | 166 |
| School & Office Supplies | 2115 | Other Office & School Supplies | 161 |
| Vehicle Parts & Accessories | 100001610 | ATV/UTV Parts & Accessories | 163 |

## 3. 顶层组件逐项矩阵

状态说明：

- **已覆盖**：有系统入口或可靠自动映射，并能生成 Schema 提交结构。
- **条件覆盖**：仅在相应交易模式或店铺能力启用时出现，系统按条件校验。
- **平台字段**：只读、状态或内部传输字段，不应由卖家填写。
- **待线上验证**：本地接口及入口已实现，但当前店铺权限或真实写入结果尚未获得生产证据。

| # | Alibaba 顶层组件 | 人工上品含义 | 系统入口/来源 | 接口或提交方式 | 状态 |
|---:|---|---|---|---|---|
| 1 | `infos` | Schema 分区标签 | 不填写 | 仅用于渲染结构 | 平台字段 |
| 2 | `productFeature` | 平台商品特征组件 | 不猜测、不填写 | Schema 未返回安全选项 | 平台字段 |
| 3 | `catId` | 最终叶子类目 | AI 推荐 + 真实类目树人工确认 | category get/schema get；发布请求 `cat_id` | 已覆盖 |
| 4 | `icbuCatProp` | 类目属性 | Schema 动态任务表单 | Schema XML；联动项调用 schema-level | 已覆盖 |
| 5 | `saleProp` | 销售属性 | 规格编辑器/动态任务 | Schema XML | 已覆盖 |
| 6 | `sku` | SKU 组合、价格、库存、编码 | SKU 笛卡尔积编辑器 | Schema `multiComplex` | 已覆盖 |
| 7 | `sampleSku` | 样品 SKU | 动态重复组 | Schema `multiComplex` | 条件覆盖 |
| 8 | `productTitle` | 英文商品标题 | AI 建议，人工确认可改 | Schema XML | 已覆盖 |
| 9 | `inventory` | 仓库库存 | 库存输入 + 店铺库存地点编码 | Schema `warehouseCode/srcValue`；草稿后按官方 TOP 增减库存协议更新 | 已覆盖（本地修复） |
| 10 | `scImages` | 最多 6 张主图 | 本地上传/图片银行/AI 图；人工设主图和排序 | 先上传图片银行，再写 URL + `fileId`；按当前类目 `maxImageSizeRule` 校验 | 已覆盖（本地修复） |
| 11 | `imageVideo` | 主图视频，≤45 秒、≤100MB | Alibaba 视频库搜索、选择、移除；草稿后自动关联 | TOP `video.query` / `video.upload` / `video.relation.product.main` | 待线上验证（本地已实现） |
| 12 | `detailVideo` | 详情视频，≤10 分钟、≤500MB | Alibaba 视频库搜索、选择、移除；草稿后自动关联 | TOP `video.query` / `video.upload` / `video.relation.product.detail` | 待线上验证（本地已实现） |
| 13 | `productKeywords` | 搜索关键词 | AI 建议，人工确认可改 | Schema XML | 已覆盖 |
| 14 | `pkgMeasure` | 包装长宽高 | 批量补空/商品详情 | Schema XML | 已覆盖 |
| 15 | `pkgWeight` | 包装重量 | 批量补空/商品详情 | Schema XML | 已覆盖 |
| 16 | `ApiPostLevelAttrAdapter` | 平台内部后置属性适配 | 不填写 | 平台内部传输字段 | 平台字段 |
| 17 | `boxPackaging` | 店铺箱规 | 真实店铺箱规选择 + 装箱数/总重 | Schema 真实 options | 已覆盖 |
| 18 | `ladderPeriod` | 阶梯发货期 | 交期输入/动态任务 | Schema XML | 条件覆盖 |
| 19 | `priceUnit` | 计价单位 | 通用模板真实选项 | Schema XML | 已覆盖 |
| 20 | `platformLogisticsServices` | 平台物流服务 | Schema 真实选项 | Schema XML | 条件覆盖 |
| 21 | `shippingTemplate` | 运费方式/运费模板 | 通用模板从当前店铺 Schema 选择 | Schema 真实 options | 已覆盖 |
| 22 | `productGroup` | 店铺商品分组 | 店铺同步/商品分组选择 | product group get + Schema XML | 已覆盖 |
| 23 | `ladderPrice` | 阶梯价 | 价格模式为阶梯价时显示 | Schema XML；仅模式 1 校验 | 条件覆盖 |
| 24 | `customMoreProperty` | 自定义补充属性 | 动态重复组 | Schema XML | 已覆盖 |
| 25 | `fob` | FOB 价格范围和单位 | 价格模式为 FOB 时显示 | Schema XML；仅模式 2 校验 | 条件覆盖 |
| 26 | `saleType` | 按件/按批销售 | 真实枚举选择 | Schema XML | 已覆盖 |
| 27 | `batchNum` | 每批数量 | 商品详情/动态任务 | Schema XML | 条件覆盖 |
| 28 | `scPrice` | 价格模式 | 阶梯价、FOB、SKU 定价选择 | Schema XML | 已覆盖 |
| 29 | `minOrderQuantity` | 最小起订量 | MOQ 输入 | Schema XML | 已覆盖 |
| 30 | `productDescType` | 详情描述类型 | Schema 默认值/动态任务 | Schema XML | 已覆盖 |
| 31 | `detailImage` | 图片详情 | 自动生成初始图库；可改图库类型、图片、顺序和说明，支持本地图片直传图片银行 | 图片银行 URL 写入嵌套详情结构 | 已覆盖（本地修复） |
| 32 | `textDesc` | 文本详情 | AI 文案，人工确认可改 | Schema XML | 已覆盖 |
| 33 | `companyImage` | 公司介绍图片 | 动态嵌套图库；可选公司场景并本地直传图片银行 | Schema XML | 已覆盖（本地修复） |
| 34 | `companyDesc` | 公司介绍 | 动态文本任务/模板 | Schema XML | 已覆盖 |
| 35 | `companyFaqDesc` | 公司 FAQ | 动态重复组 | Schema XML | 已覆盖 |
| 36 | `productQuality` | 平台质量状态 | 不填写 | 平台状态回传 | 平台字段 |
| 37 | `marketSample` | 样品服务开关 | 真实枚举选择 | Schema XML | 条件覆盖 |
| 38 | `marketSamplingQuantity` | 样品数量 | 样品服务启用后填写 | Schema XML | 条件覆盖 |
| 39 | `marketSamplingPrice` | 样品价格 | 样品服务启用后填写 | Schema XML | 条件覆盖 |
| 40 | `multilangInfo` | 多语言扩展容器 | 当前 Schema 为空，不填写 | 空结构组件 | 平台字段 |
| 41 | `logisticsProperty` | 物流属性 | Schema 真实枚举 | Schema XML | 已覆盖 |
| 42 | `logisticsSku` | SKU 级重量、尺寸、箱规 | SKU 重复组；箱规复用顶层真实店铺选项 | Schema XML | 已覆盖（本地修复） |
| 43 | `supportLogisticsSku` | 平台是否支持 SKU 物流 | 不填写 | Schema 无可提交选项 | 平台字段 |
| 44 | `semiManagedPeriod` | 半托管履约周期 | 动态任务/Schema 默认值 | Schema XML | 条件覆盖 |
| 45 | `tariffsHsCode` | 关税/HS 编码 | 商品详情动态任务 | Schema 嵌套结构 | 已覆盖 |
| 46 | `designAndSampleService` | 设计与打样服务 | Schema 真实枚举 | Schema XML | 条件覆盖 |

## 4. 图片链路验收

| 来源 | 当前本地行为 | 是否满足阿里要求 |
|---|---|---|
| 本地上传图 | 创建草稿前自动上传图片银行，取得 URL + `fileId` | 是 |
| 图片银行选图 | 直接使用当前店铺返回的 URL + `fileId` | 是 |
| AI 生成图 | 后端把临时地址转为稳定数据图；用户确认加入后生成真实 File；创建草稿前上传图片银行 | 本地已修复 |
| 主图顺序 | 用户选择的主图固定写入 `scImages_0` | 本地已修复 |
| 图片数量 | 主图轮播取选中主图优先的前 6 张；全部图片用于详情；界面明确提示 | 本地已修复 |
| 无可上传文件的图片 | 创建草稿前明确报错，不再静默跳过 | 本地已修复 |
| 图片大小 | 本地上传和后端图片银行接口强制 ≤5 MB；选定类目后再按实时 Schema 的 `maxImageSizeRule`（本样本为 4 MiB）二次校验 | 本地已修复并通过测试 |

## 5. 官方接口协议修正

| 操作 | 官方协议 | 当前实现与验证 |
|---|---|---|
| Schema 草稿渲染 | `param_product_top_publish_request` 嵌套请求对象 | 已修正并通过协议级测试 |
| Schema 更新 | `param_product_top_publish_request` 嵌套请求对象 | 已修正并通过协议级测试 |
| SKU 库存查询 | `alibaba.icbu.product.sku.inventory.get` | 已切换 TOP 客户端并通过协议级测试 |
| 库存更新 | `alibaba.icbu.product.inventory.update`，`request_param` 嵌套对象，库存为增减量且必须指定 `plus/sub` | 已修正并通过协议级测试 |
| 上下架 | 先调用 `alibaba.icbu.product.id.encrypt` 获取密文 ID，再调用 `alibaba.icbu.product.batch.update.display`，状态为 `on/off` | 已修正并通过协议级测试 |
| TOP 业务错误 | HTTP 200 但 `success/biz_success/sub_success=false` | 客户端已统一识别为失败，不再误判成功 |
| 类目发品资格 | `alibaba.icbu.product.type.available.get`，按叶子类目查询下单品/询盘品权限 | 确认类目时只读预检；两种类型均无权限则阻止继续，已通过协议级测试 |

## 6. 条件字段与草稿回读

| 项目 | 当前本地行为 | 验收状态 |
|---|---|---|
| Schema 条件禁用 | 前端执行 Alibaba `disableRule`；失效字段不显示、不计必填，并在草稿同步前清除 | 本地已修复 |
| 详情图库人工修改 | 已有人工图库值优先，创建草稿前不会再被自动映射覆盖 | 本地已修复 |
| 提交值提取 | 从最终提交 Schema XML 提取实际写入的顶层组件，而非拿前端辅助字段做比较 | 通过单元测试 |
| 平台回读值提取 | 解析 Alibaba 回读响应内的已填 Schema XML | 通过单元测试 |
| 平台漏字段 | 已提交字段未出现在回读 XML 时记为 `changed`，禁止静默通过 | 通过单元测试 |
| 平台转换字段 | 显示提交值与平台值，人工明确接受后才能进入正式发布确认 | 前端构建通过 |
| 缺少商品 ID | 明确判定无法回读并阻止发布 | 通过单元测试 |

## 7. 尚未完成的验收门槛

1. **视频接口授权与真实关联**：本地已实现 TOP HMAC-MD5 客户端、视频查询、HTTPS URL/本地文件上传、主图/详情关联及前端选择器；仍需在生产店铺验证当前 app key/session 是否拥有 `alibaba.icbu.video.*` 权限，以及草稿商品 ID 是否允许关联。权限或关联失败会明确阻止正式发布。
2. **本地视频公网抓取**：官方 TOP 上传接口只接收公网 `video_path`。当前后端会把本地文件流式暂存到随机公开 URL，再交给 TOP；生产环境仍需验证 `PUBLIC_BASE_URL`、Nginx `client_max_body_size 520m`、持久目录和 Alibaba 外网抓取均正常。
3. **生产部署**：本文件标记“本地修复”的项目尚未部署；部署涉及服务配置、Nginx 和真实生产 API，需由用户明确确认生产变更。
4. **真实草稿回读**：至少选择 3 个差异明显的叶子类目，各创建 1 个仅保存不发布的草稿，并解析 render/get 返回的已填 Schema XML，对实际提交的顶层组件逐项比对；平台转换须由卖家明确确认。
5. **正式发布验收**：草稿回读一致后，由卖家在发布确认弹窗中显式确认；不能用单元测试替代真实阿里返回结果。

## 8. 官方接口依据

- 商品发布 Schema、图片银行与发布流程：<https://developer.alibaba.com/docs/doc.htm?articleId=119213&docType=1&treeId=456>
- 图片银行上传：<https://developer.alibaba.com/docs/api.htm?apiId=24463>
- Schema 草稿渲染：<https://developer.alibaba.com/docs/api.htm?apiId=50205>
- Schema 更新：<https://developer.alibaba.com/docs/api.htm?apiId=50189>
- SKU 库存查询：<https://developer.alibaba.com/docs/api.htm?apiId=57873>
- 库存更新：<https://developer.alibaba.com/docs/api.htm?apiId=53178>
- 商品 ID 加密：<https://developer.alibaba.com/docs/api.htm?apiId=50558>
- 商品上下架：<https://developer.alibaba.com/docs/api.htm?apiId=44413>
- 商家发品类型查询：<https://developer.alibaba.com/docs/api.htm?apiId=62123>
- 视频文件上传 `alibaba.icbu.video.upload`：<https://developer.alibaba.com/docs/api.htm?apiId=50133>
- 视频查询 `alibaba.icbu.video.query`：<https://developer.alibaba.com/docs/api.htm?apiId=49930>
- 主图视频关联 `alibaba.icbu.video.relation.product.main`：<https://developer.alibaba.com/docs/api.htm?apiId=50089>
- 详情视频关联 `alibaba.icbu.video.relation.product.detail`：<https://developer.alibaba.com/docs/api.htm?apiId=50088>
