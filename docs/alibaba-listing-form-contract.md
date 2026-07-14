# Alibaba 批量上品动态表单约定

批量上品表单以 `alibaba.icbu.product.schema.get` 返回的实时类目 Schema 为唯一字段真源。Excel 模板和演示数据只用于理解业务分组，不用于把固定字段设为所有类目的必填项。

## 页面取数顺序

1. 用户确认最终叶子类目。
2. 前端调用 `GET /api/v1/alibaba/categories/{category_id}/schema`。
3. 前端调用 `POST /api/v1/alibaba/schemas/guidance` 解析字段类型、必填规则、枚举、长度提示和来源限制。
4. 合并已确认 AI 内容、商品真实资料、业务系统数据和允许继承的店铺默认值。
5. “补齐事实”仅展示仍未解决的必填字段。
6. 创建草稿前由后端重新解析原始 Schema、构建 XML 并执行完整规则校验。

## Schema 类型与控件

| Alibaba Schema 类型 | 前端控件 | 写入结构 |
| --- | --- | --- |
| `input` | 单行输入框 | `<value>` |
| `multiInput` | 每行一个值的多行输入框 | `<values><value>` |
| `singleCheck` | 单选下拉框 | 候选项的 `value` |
| `multiCheck` | 多选复选框组 | 多个候选项 `value` |
| `complex` | 按字段路径展开必要叶子字段 | `<complex-value>` |
| `multiComplex` | 按字段路径展开必要叶子字段 | 多个 `<complex-value>` |
| `label`、`hidden`、只读或禁用字段 | 不展示为用户输入 | 保留 Schema 原结构 |

候选项必须提交 Alibaba 返回的 `value`，不能提交本地翻译后的展示名称。`maxLengthRule`、`tipRule`、`valueAttributeRule`、`asyncQueryRule` 和复合字段联动由后端在草稿和发布前再次校验。

## 来源门禁

| 来源 | 可直接进入草稿 | 用途 |
| --- | --- | --- |
| `image_extracted` | 否 | 图片中可观察到的候选事实 |
| `ai_generated` | 否 | 标题、关键词、卖点、描述、类目建议 |
| `user_confirmed` | 是 | 用户确认后的 AI 内容和图片 |
| `user_provided` | 是 | 价格、MOQ、库存、包装、合规等真实资料 |
| `business_system` | 是 | ERP 或其他可信业务系统数据 |
| `account_default` | 仅白名单字段 | 币种、计量单位、运费模板、仓库、商品组等店铺级设置 |

价格、MOQ、SKU、库存、材质、尺寸、重量、包装、认证、原产地和物流信息不能由 AI 猜测。AI 候选只有在用户确认后才能改写为 `user_confirmed`。

## 用户实际需要填写的字段

不同类目返回的字段不同，常见分组如下：

- 基础发布：标题、类目属性、品牌、型号、材质、颜色和规格。
- SKU 与交易：销售属性组合、SKU 编码、SKU 图片、币种、计量单位、价格、MOQ、阶梯价和库存。
- 包装与履约：交期、包装数量、毛重、长宽高、仓库、物流属性和运费模板。
- 合规：原产地、HS Code、认证、商标、专利及类目特定声明。
- 素材与详情：图片银行主图、详情图、卖点和详情描述。

不存在一份对所有类目都有效的固定表单。完整表单必须在用户确认叶子类目后，
读取 `alibaba.icbu.product.schema.get` 的 XML；同一类目的商家能力、商品类型和
Schema 版本也可能改变字段和选项。

## API 字段类型和表单控件

| Schema 返回 | 页面控件 | 谁提供值 |
| --- | --- | --- |
| `input` | 单行文本、数字或日期输入 | 按字段责任分配 |
| `multiInput` | 多值输入，每行一个值 | 按字段责任分配 |
| `singleCheck` | 从 API `options` 中单选 | 客户确认 API 枚举值 |
| `multiCheck` | 从 API `options` 中多选 | 客户确认 API 枚举值 |
| `complex` | 展开组合字段的必填子项 | 每个子项独立分配责任 |
| `multiComplex` | 可新增多组组合字段 | 每组子项独立分配责任 |
| `label`、`hidden`、只读、禁用 | 不生成输入控件 | Alibaba 系统 |

`singleCheck` 和 `multiCheck` 必须提交 Alibaba 返回的 `option.value`，不能提交中文
展示名。带 `asyncQueryRule` 的联动选项必须先提交已选上级字段到
`alibaba.icbu.category.schema.level.get`，再使用返回的新一层 `options`；选项未加载时
不能退化成自由文本。未知字段、未知枚举和未识别的复合字段默认交给客户，不能默认交给 AI。

## 字段责任分配

| 责任 | 典型字段 | 系统行为 |
| --- | --- | --- |
| AI 先填，客户确认 | 标题、关键词、卖点、描述、可见颜色/花纹/形状、用途建议、图片候选 | 先保存为 `ai_generated` 或 `image_extracted`，确认后改为 `user_confirmed` |
| 店铺默认 | 币种、计量单位、仓库、库存地点、运费模板、商品组、图片银行组、已确认公司和服务文案 | 从 `account_default` 带入；只允许白名单字段 |
| ERP / 客户事实 | 品牌、型号、材质、规格、SKU、价格、MOQ、库存、重量尺寸、包装、交期、物流、原产地、HS Code、认证 | 优先从 `business_system` 同步，缺失时由客户填写；原产地不自动当作全店默认 |
| 客户填写 | 最终叶子类目、API 未识别字段、类目特殊声明、权利和合规确认、无法从 ERP 获取的字段 | 默认 `user_provided`，不得由 AI 猜测 |
| Alibaba 系统 | 必填规则、字段类型、枚举选项、联动、只读值、校验错误、商品 ID 和审核状态 | API 返回，不由客户或 AI 编造 |

安全默认规则是：

```text
字段已明确列入 AI 安全白名单
  → AI 生成候选，客户确认
字段属于店铺默认白名单
  → 从已确认店铺设置带入
字段属于交易、SKU、供应链、包装或合规事实
  → ERP 优先，客户补充
其他所有未知字段
  → 客户填写
```

页面先给客户一个二元结论：

```text
AI 可先填
  = 营销文案 + 图片中可以直接观察的属性
  = 仍必须由客户确认

AI 不得填写
  = 交易 + SKU + 供应链 + 包装 + 履约 + 合规 + 权利 + 未知字段
  = 再细分为 ERP / 客户事实、客户填写、店铺默认
```

前端不固定展示以上全部字段。只有同时满足以下条件的字段才出现在“填写必要信息”中：

```text
Schema 判定 required
AND 当前值为空
AND 未由 user_confirmed / business_system / account_default 安全解决
AND 不是已确认标题或已上传图片
```

字段旁必须展示“API 必填”和来源要求；已经安全解决的字段折叠隐藏，并在摘要中显示自动带入数量。

## 严格步骤门禁

```text
1 上传图片并完成分析
  → 2 全部确认 AI 候选
  → 3 全部补齐实时 Schema 必填事实
  → 4 创建草稿并记录单品结果
  → 5 回读成功草稿并明确确认后发布
```

页面刷新、演示数据或已有商品都不能直接解锁后续步骤。单商品草稿或发布失败需要隔离展示，不影响成功商品继续回读，但失败商品必须保留原因和重试入口。

## 头部工具流程对照

公开资料中可以确认的共同模式：

1. **Alibaba Seller Central**：先选类目或下载类目模板，再使用单品发布、Bulk Upload、
   图片/视频银行和商品分组；平台字段与校验仍是最终标准。
2. **店小秘**：采集或搬家到采集箱，认领到目标平台，选择类目，编辑优化，
   使用模板复用通用属性/包装/物流配置，再发布；AI 和图片工具用于优化，不替代真实交易事实。
3. **通途 Listing**：建立共用产品资料，采集或新建商品，使用平台模板，
   AI 处理标题、描述、翻译、抠图和场景图，批量修改后生成刊登草稿并发布。
4. **BigSeller**：公开资料能确认其通用多平台模式是采集、批量编辑、AI 优化和定时发布，
   但本次没有找到足够公开依据证明其当前直接支持 Alibaba.com 刊登，因此只作为交互模式参考，
   不作为 Alibaba API 字段依据。

本项目采用的正确流程是：

```text
素材/ERP 导入
→ AI 内容和套图候选
→ 客户确认
→ 读取 Alibaba 实时 Schema
→ 店铺默认和 ERP 自动带入
→ 客户只补剩余必填项及枚举选择
→ 创建草稿
→ 回读核对
→ 二次确认发布
→ 审核、质量分和库存维护
```

公开依据：

- [Alibaba ICBU Schema 获取](https://developer.alibaba.com/doc2/apiDetail.htm?apiId=50063)
- [Alibaba ICBU Schema 回读](https://developer.alibaba.com/docs/api.htm?apiId=50188)
- [Alibaba Product Tools](https://seller.alibaba.com/pages/producttools/index.html)
- [店小秘产品刊登帮助](https://help.dianxiaomi.com/video/productListing/2650)
- [通途 Listing](https://www.tongtool.com/listing.html)
- [通途 AI 与多平台刊登能力](https://www.tongtool.com/activity-45.html)
- [BigSeller 多渠道商品管理](https://www.bigseller.com/m/en_US/introduction/product.htm)
