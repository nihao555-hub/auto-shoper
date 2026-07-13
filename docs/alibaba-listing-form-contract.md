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
