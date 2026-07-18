import re
from typing import Literal

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
    "fobunittype",
    "imagestyleprompt",
    "inventorycode",
    "photobankgroupid",
    "priceunit",
    "productgroupid",
    "servicepolicy",
    "shippingtemplate",
    "shippingtemplateid",
    "warehouseid",
}
MANUAL_FACT_ALIASES = {
    "cat_id",
    "categoryid",
    "certification",
    "certifications",
    "composition",
    "currency",
    "deliverytime",
    "dimension",
    "dimensions",
    "fob",
    "hs_code",
    "inventory",
    "manufacturer",
    "model",
    "modelnumber",
    "ladderprice",
    "leadtime",
    "logistics",
    "material",
    "minorderquantity",
    "moq",
    "origin",
    "package",
    "packaging",
    "barcode",
    "carton",
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
    "supplyability",
    "productioncapacity",
    "paymentterm",
    "tradeterm",
    "incoterm",
    "gtin",
    "ean",
    "upc",
    "mpn",
    "weight",
}
MANUAL_FIELD_KEYS = {_compact_field_name(name) for name in MANUAL_FIELD_NAMES}
MANUAL_FACT_ALIAS_KEYS = {_compact_field_name(name) for name in MANUAL_FACT_ALIASES}
STORE_DEFAULT_KEYS = {_compact_field_name(name) for name in STORE_DEFAULT_ALIASES}
AI_ASSISTED_ALIASES = {
    "application",
    "appearance",
    "color",
    "colour",
    "component",
    "description",
    "design",
    "feature",
    "image",
    "keyword",
    "pattern",
    "sellingpoint",
    "shape",
    "style",
    "subject",
    "title",
    "usage",
    "use",
}
MERCHANT_CONFIRMATION_ALIASES = {
    "aftersaleslimit",
    "authorization",
    "brandrights",
    "categoryspecificdeclaration",
    "claim",
    "companyimage",
    "compliancestatement",
    "copyright",
    "customizationlimit",
    "dangerousgoodsdeclaration",
    "declaration",
    "designandsampleservice",
    "imagerights",
    "imagevideo",
    "ownership",
    "patent",
    "productvideo",
    "productrights",
    "regulatorydeclaration",
    "safetydeclaration",
    "sampleservice",
    "servicecommitment",
    "servicepromise",
    "specialdeclaration",
    "trademark",
    "warrantyterms",
}
BUSINESS_SYSTEM_ALIASES = {
    "barcode",
    "brand",
    "capacity",
    "carton",
    "certification",
    "composition",
    "currency",
    "deliverytime",
    "dimension",
    "hs_code",
    "inventory",
    "manufacturer",
    "ladderprice",
    "leadtime",
    "logistics",
    "material",
    "model",
    "modelnumber",
    "minorderquantity",
    "moq",
    "origin",
    "package",
    "port",
    "price",
    "productioncapacity",
    "paymentterm",
    "shipping",
    "sku",
    "stock",
    "supplyquantity",
    "supplyability",
    "tradeterm",
    "incoterm",
    "gtin",
    "ean",
    "upc",
    "mpn",
    "weight",
}
AI_ASSISTED_KEYS = {_compact_field_name(name) for name in AI_ASSISTED_ALIASES}
MERCHANT_CONFIRMATION_KEYS = {
    _compact_field_name(name) for name in MERCHANT_CONFIRMATION_ALIASES
}
BUSINESS_SYSTEM_KEYS = {_compact_field_name(name) for name in BUSINESS_SYSTEM_ALIASES}


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
        if not _field_or_descendant_present(effective, name)
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


def listing_quality_errors(fields: dict[str, DraftField]) -> list[tuple[str, str]]:
    """Return hard blockers for Alibaba's title/attribute and image rules."""
    title_field = next(
        (field for name, field in fields.items() if _compact_field_name(name) in {"producttitle", "subject", "title"}),
        None,
    )
    title = str(title_field.value or "").lower() if title_field else ""
    errors: list[tuple[str, str]] = []

    def token_value(tokens: tuple[str, ...]) -> str:
        for name, field in fields.items():
            compact = _compact_field_name(name)
            if any(token in compact for token in tokens) and field.value not in (None, "", [], {}):
                value = field.value
                if isinstance(value, list):
                    return " ".join(str(item) for item in value).lower()
                return str(value).lower()
        return ""

    material = token_value(("material", "caizhi"))
    if "cotton" in title and material and "cotton" not in material:
        errors.append(("title_attribute_conflict", "标题包含 Cotton，但材质属性未包含 Cotton"))
    sheets = re.search(r"(\d+)\s*sheets?", title)
    pages = token_value(("innerpages", "pages", "yeshu", "zhangshu"))
    if sheets and pages and sheets.group(1) not in pages:
        errors.append(("title_attribute_conflict", f"标题包含 {sheets.group(1)} Sheets，但页数属性为 {pages}"))
    size = re.search(r"(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|inch|cm)", title)
    size_value = token_value(("size", "chicun"))
    if size and size_value and size.group(1) not in size_value and size.group(2) not in size_value:
        errors.append(("title_attribute_conflict", "标题包含尺寸，但尺寸属性未匹配"))

    detail = get_listing_field(fields, "detailImage")
    # 只有阿里当前类目 Schema 返回了 detailImage 字段时才校验分类；
    # 旧类目/兼容流程可能没有该字段，不能因为新规则破坏原有草稿流程。
    if detail is not None:
        groups = detail.value if isinstance(detail.value, list) else []
        classified = any(
            isinstance(group, dict) and str(group.get("gallery", "")) in {"200", "300"}
            for group in groups
        )
        if not classified:
            errors.append(("detail_image_classification", "详情图片必须标记为细节图或场景图"))
    return errors


def _field_or_descendant_present(
    fields: dict[str, DraftField],
    field_name: str,
) -> bool:
    direct = get_listing_field(fields, field_name)
    if direct is not None and direct.value not in (None, "", [], {}):
        return True
    target = field_name.lower().replace("/", ".").rstrip(".")
    return any(
        name.lower().replace("/", ".").startswith(f"{target}.")
        and field.value not in (None, "", [], {})
        for name, field in fields.items()
    )


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
        or any(
            len(alias) >= 5 and alias in normalized
            for alias in MANUAL_FACT_ALIAS_KEYS
        )
    )


def is_merchant_confirmation_field(field_name: str) -> bool:
    normalized = _compact_field_name(field_name)
    parts = {
        _compact_field_name(part)
        for part in field_name.replace("/", ".").split(".")
    }
    return bool(
        normalized in MERCHANT_CONFIRMATION_KEYS
        or parts & MERCHANT_CONFIRMATION_KEYS
        or any(
            len(alias) >= 5 and alias in normalized
            for alias in MERCHANT_CONFIRMATION_KEYS
        )
    )


def is_ai_assisted_field(field_name: str) -> bool:
    normalized = _compact_field_name(field_name)
    parts = {
        _compact_field_name(part)
        for part in field_name.replace("/", ".").split(".")
    }
    return bool(
        not is_manual_fact_field(field_name)
        and not is_merchant_confirmation_field(field_name)
        and (
            normalized in AI_ASSISTED_KEYS
            or parts & AI_ASSISTED_KEYS
            or any(
                len(alias) >= 4 and alias in normalized
                for alias in AI_ASSISTED_KEYS
            )
        )
    )


def schema_field_responsibility(
    field_name: str,
) -> tuple[
    Literal["ai_candidate", "merchant", "business_system", "store_default"],
    str,
    str,
    list[FieldSource],
]:
    if is_store_default_field(field_name):
        return (
            "store_default",
            "店铺默认",
            "从已确认的店铺配置带入，客户只需维护一次",
            [
                FieldSource.ACCOUNT_DEFAULT,
                FieldSource.USER_CONFIRMED,
                FieldSource.BUSINESS_SYSTEM,
            ],
        )
    if is_merchant_confirmation_field(field_name):
        return (
            "merchant",
            "客户填写",
            "涉及声明、权利或承诺，必须由客户提供并确认",
            [
                FieldSource.USER_PROVIDED,
                FieldSource.USER_CONFIRMED,
                FieldSource.BUSINESS_SYSTEM,
            ],
        )
    normalized = _compact_field_name(field_name)
    if is_manual_fact_field(field_name) or any(
        len(alias) >= 4 and alias in normalized
        for alias in BUSINESS_SYSTEM_KEYS
    ):
        return (
            "business_system",
            "ERP / 客户事实",
            "优先从 ERP、商品档案或供应链系统同步，缺失时由客户填写",
            [
                FieldSource.BUSINESS_SYSTEM,
                FieldSource.USER_PROVIDED,
                FieldSource.USER_CONFIRMED,
            ],
        )
    if is_ai_assisted_field(field_name):
        return (
            "ai_candidate",
            "AI 先填·客户确认",
            "AI 只能生成候选，客户确认后才能提交",
            [
                FieldSource.IMAGE_EXTRACTED,
                FieldSource.AI_GENERATED,
                FieldSource.USER_CONFIRMED,
            ],
        )
    return (
        "merchant",
        "客户填写",
        "API 未证明该字段可由 AI 安全生成，默认要求客户提供真实值",
        [
            FieldSource.USER_PROVIDED,
            FieldSource.USER_CONFIRMED,
            FieldSource.BUSINESS_SYSTEM,
        ],
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
