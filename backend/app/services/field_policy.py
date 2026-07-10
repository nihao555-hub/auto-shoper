from backend.app.models import (
    DraftField,
    FieldSource,
    ManualRequirement,
    ProductValidationResult,
)

MANUAL_REQUIREMENTS = [
    ManualRequirement(name="category_id", label="最终叶子类目", reason="类目选择影响全部发布规则"),
    ManualRequirement(name="price", label="价格/阶梯价", reason="图片和模型无法得知真实商业报价"),
    ManualRequirement(name="currency", label="币种", reason="必须与报价和店铺设置一致"),
    ManualRequirement(name="moq", label="最小起订量", reason="属于真实交易条件"),
    ManualRequirement(name="sku", label="SKU/型号", reason="必须来自企业商品系统"),
    ManualRequirement(name="material", label="材质/成分", reason="外观不能可靠证明材质"),
    ManualRequirement(name="dimensions", label="尺寸", reason="没有比例尺时无法从图片精确测量"),
    ManualRequirement(name="weight", label="重量", reason="图片不能确定重量"),
    ManualRequirement(name="packaging", label="包装参数", reason="必须来自实际包装方案"),
    ManualRequirement(name="certifications", label="认证/合规", reason="禁止生成不存在的认证声明"),
    ManualRequirement(name="inventory", label="库存", reason="必须来自库存系统或人工盘点"),
    ManualRequirement(name="lead_time", label="交期", reason="必须来自生产和供应链计划"),
    ManualRequirement(name="origin", label="原产地", reason="属于合规事实"),
]

MANUAL_FIELD_NAMES = {item.name for item in MANUAL_REQUIREMENTS}
TRUSTED_SOURCES = {FieldSource.USER_PROVIDED, FieldSource.BUSINESS_SYSTEM}
BASE_REQUIRED_FIELDS = {"category_id"}
MANUAL_FACT_ALIASES = {
    "cat_id",
    "categoryid",
    "certification",
    "certifications",
    "currency",
    "deliverytime",
    "dimension",
    "dimensions",
    "fob",
    "hs_code",
    "inventory",
    "ladderprice",
    "leadtime",
    "logistics",
    "material",
    "moq",
    "origin",
    "package",
    "packaging",
    "packagedimension",
    "packageheight",
    "packagelength",
    "packageweight",
    "packagewidth",
    "port",
    "price",
    "priceunit",
    "shipping",
    "shippingtemplateid",
    "sku",
    "skuouterid",
    "skuprice",
    "skustock",
    "stock",
    "supplyquantity",
    "weight",
}


def validate_product_fields(
    fields: dict[str, DraftField],
    schema_required_fields: list[str],
    manual_fact_fields: list[str] | None = None,
) -> ProductValidationResult:
    required = BASE_REQUIRED_FIELDS | set(schema_required_fields)
    missing = sorted(
        name
        for name in required
        if not fields.get(name) or fields[name].value in (None, "")
    )
    invalid_ai = sorted(
        name
        for name in _manual_field_names(fields, manual_fact_fields or [])
        if name in fields
        and fields[name].value not in (None, "")
        and fields[name].source not in TRUSTED_SOURCES
    )
    confirmation = sorted(
        name
        for name, field in fields.items()
        if field.value not in (None, "") and field.requires_confirmation
    )
    return ProductValidationResult(
        ready_to_publish=not missing and not invalid_ai and not confirmation,
        missing_fields=missing,
        invalid_ai_fields=invalid_ai,
        confirmation_fields=confirmation,
    )


def is_manual_fact_field(field_name: str) -> bool:
    normalized = _normalize_field_name(field_name)
    parts = {_normalize_field_name(part) for part in field_name.replace("/", ".").split(".")}
    return bool(
        normalized in MANUAL_FIELD_NAMES
        or normalized in MANUAL_FACT_ALIASES
        or parts & MANUAL_FACT_ALIASES
    )


def _manual_field_names(fields: dict[str, DraftField], schema_manual_fields: list[str]) -> set[str]:
    manual = set(MANUAL_FIELD_NAMES) | set(schema_manual_fields)
    manual.update(name for name in fields if is_manual_fact_field(name))
    return manual


def _normalize_field_name(field_name: str) -> str:
    return "".join(char.lower() for char in field_name if char.isalnum() or char == "_")
