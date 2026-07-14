# 商品资料导入格式

工作台支持 `.csv`、`.xlsx` 和通用 ERP `.json` 文件。第一行必须是表头，每一行代表一个商品；`商品编码`/`reference`/`sku` 为必填列。

## 推荐表头

| 中文表头 | 英文字段 | 说明 |
| --- | --- | --- |
| 商品编码 | `reference` | 商品或 SPU 的唯一编码 |
| 英文标题 | `subject` | 可继续在 AI 确认步骤修改 |
| 类目 ID | `category_id` | Alibaba 叶子类目 ID |
| 品牌 | `brand` | 商家真实品牌 |
| 型号 | `model` | 商家或 ERP 型号 |
| 材质 | `material` | 真实材质 |
| 价格 | `price` | 数字，不包含币种符号 |
| 起订量 | `moq` | 最小起订数量 |
| 库存 | `inventory` | 可售库存 |
| 交期 | `lead_time` | 发货天数 |
| 原产地 | `origin` | 例如 `CN` |
| 海关编码 | `hs_code` | HS Code |
| 认证 | `certifications` | 多个值用逗号、分号或竖线分隔 |
| SKU 明细 | `sku_rows` | JSON 数组，适用于 CSV/XLSX 单元格 |

系统也识别常见别名，例如 `title`、`stock`、`cat_id`、`unit_price`、`货号`和`产品编码`。

## ERP JSON 示例

```json
{
  "items": [
    {
      "sku": "BRUSH-001",
      "title": "Professional Paint Brush Set",
      "category_id": "100001",
      "price": "8.90",
      "moq": "10",
      "stock": "320",
      "skus": [
        {
          "sku": "BRUSH-001-RED",
          "attributes": "Color: Red / Size: 2 inch",
          "price": "8.90",
          "stock": "120"
        }
      ]
    }
  ]
}
```

顶层也可以直接使用数组，或使用 `products`、`rows` 包装数组。导入值统一标记为 `business_system`，仍需经过实时 Alibaba Schema 校验；系统不会因为数据来自文件而自动视为已确认发布。
