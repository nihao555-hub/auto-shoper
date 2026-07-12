from backend.app.models import (
    DraftField,
    FieldSource,
    ManualRequirement,
    ProductValidationResult,
)


def _compact_field_name(field_name: str) -> str:
    return "".join(char.lower() for char in field_name if char.isalnum())


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
AI_SOURCES = {FieldSource.IMAGE_EXTRACTED, FieldSource.AI_GENERATED}
TRUSTED_SOURCES = {
    FieldSource.USER_PROVIDED,
    FieldSource.USER_CONFIRMED,
    FieldSource.BUSINESS_SYSTEM,
}
STORE_DEFAULT_SOURCES = TRUSTED_SOURCES | {FieldSource.ACCOUNT_DEFAULT}
BASE_REQUIRED_FIELDS = {"category_id"}
STORE_DEFAULT_ALIASES = {
    "aftersalespolicy",
    "companyprofile",
    "currency",
    "customizationpolicy",
    "detailpagetemplate",
    "detailtemplate",
    "imagestyleprompt",
    "inventorycode",
    "photobankgroupid",
    "priceunit",
    "productgroupid",
    "servicepolicy",
    "shippingtemplateid",
    "warehouseid",
}
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
MANUAL_FIELD_KEYS = {_compact_field_name(name) for name in MANUAL_FIELD_NAMES}
MANUAL_FACT_ALIAS_KEYS = {_compact_field_name(name) for name in MANUAL_FACT_ALIASES}
STORE_DEFAULT_KEYS = {_compact_field_name(name) for name in STORE_DEFAULT_ALIASES}


def validate_product_fields(
    fields: dict[str, DraftField],
    schema_required_fields: list[str],
    manual_fact_fields: list[str] | None = None,
    account_defaults: dict[str, DraftField] | None = None,
) -> ProductValidationResult:
    defaults = account_defaults or {}
    effective = effective_listing_fields(fields, defaults)
    required = BASE_REQUIRED_FIELDS | set(schema_required_fields)
    missing = sorted(
        name
        for name in required
        if (
            (field := get_listing_field(effective, name)) is None
            or field.value in (None, "", [], {})
        )
    )
    manual_keys = {
        _compact_field_name(name)
        for name in _manual_field_names(effective, manual_fact_fields or [])
    }
    invalid_ai = sorted(
        name
        for name, field in effective.items()
        if (
            _compact_field_name(name) in manual_keys
            and field.value not in (None, "", [], {})
            and not _trusted_for_field(name, field)
        )
    )
    invalid_defaults = sorted(_invalid_default_fields(fields, defaults))
    confirmation = sorted(
        name
        for name, field in effective.items()
        if field.value not in (None, "", [], {})
        and (field.requires_confirmation or field.source in AI_SOURCES)
    )
    return ProductValidationResult(
        ready_to_publish=(
            not missing
            and not invalid_ai
            and not invalid_defaults
            and not confirmation
        ),
        missing_fields=missing,
        invalid_ai_fields=invalid_ai,
        invalid_default_fields=invalid_defaults,
        confirmation_fields=confirmation,
    )


def effective_listing_fields(
    fields: dict[str, DraftField],
    account_defaults: dict[str, DraftField],
) -> dict[str, DraftField]:
    effective = {
        name: field
        for name, field in account_defaults.items()
        if is_store_default_field(name)
    }
    effective.update(fields)
    return effective


def get_listing_field(
    fields: dict[str, DraftField],
    field_name: str,
) -> DraftField | None:
    target = _compact_field_name(field_name)
    for name, field in fields.items():
        if _compact_field_name(name) == target:
            return field
    return None


def is_store_default_field(field_name: str) -> bool:
    normalized = _compact_field_name(field_name)
    parts = {
        _compact_field_name(part)
        for part in field_name.replace("/", ".").split(".")
    }
    return normalized in STORE_DEFAULT_KEYS or bool(parts & STORE_DEFAULT_KEYS)


def is_manual_fact_field(field_name: str) -> bool:
    normalized = _compact_field_name(field_name)
    parts = {
        _compact_field_name(part)
        for part in field_name.replace("/", ".").split(".")
    }
    return bool(
        normalized in MANUAL_FIELD_KEYS
        or normalized in MANUAL_FACT_ALIAS_KEYS
        or parts & MANUAL_FACT_ALIAS_KEYS
    )


def _manual_field_names(fields: dict[str, DraftField], schema_manual_fields: list[str]) -> set[str]:
    manual = set(MANUAL_FIELD_NAMES) | set(schema_manual_fields)
    manual.update(name for name in fields if is_manual_fact_field(name))
    return manual


def _invalid_default_fields(
    fields: dict[str, DraftField],
    account_defaults: dict[str, DraftField],
) -> set[str]:
    invalid = {
        name
        for name, field in account_defaults.items()
        if (
            not is_store_default_field(name)
            or field.source not in STORE_DEFAULT_SOURCES
            or field.requires_confirmation
        )
    }
    invalid.update(
        name
        for name, field in fields.items()
        if field.source == FieldSource.ACCOUNT_DEFAULT and not is_store_default_field(name)
    )
    return invalid


def _trusted_for_field(field_name: str, field: DraftField) -> bool:
    if field.source in TRUSTED_SOURCES:
        return True
    return field.source == FieldSource.ACCOUNT_DEFAULT and is_store_default_field(field_name)
