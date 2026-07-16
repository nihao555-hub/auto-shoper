from __future__ import annotations

from collections import Counter
from typing import Any, Literal, TypedDict

from backend.app.models import (
    DraftField,
    FieldSource,
    FieldTask,
    FieldTaskResult,
    FieldTaskSummary,
    SchemaFieldGuidance,
)
from backend.app.services.field_policy import (
    effective_listing_fields,
    get_listing_field,
    is_ai_assisted_field,
)
from backend.app.services.schema_guidance import build_schema_guidance

AI_SOURCES = {FieldSource.IMAGE_EXTRACTED, FieldSource.AI_GENERATED}
TRUSTED_SOURCES = {
    FieldSource.USER_PROVIDED,
    FieldSource.USER_CONFIRMED,
    FieldSource.BUSINESS_SYSTEM,
    FieldSource.ACCOUNT_DEFAULT,
}

FieldTaskStatus = Literal["completed", "confirm", "fill", "invalid"]


class FieldCopy(TypedDict):
    label: str
    question: str
    explanation: str
    example: str | None
    unit: str | None


def build_field_tasks(
    schema_data: dict[str, object] | str | None,
    fields: dict[str, DraftField],
    account_defaults: dict[str, DraftField] | None = None,
    category_id: str | None = None,
) -> FieldTaskResult:
    guidance = build_schema_guidance(schema_data)
    effective = effective_listing_fields(fields, account_defaults or {})
    definitions = guidance.ai_fillable_fields + guidance.manual_fact_fields
    tasks = [_task_from_guidance(item, effective) for item in definitions]
    described = {_semantic_key(item.field) for item in definitions}
    for field_path, field in effective.items():
        if (
            field.source in AI_SOURCES
            and _has_value(field.value)
            and _semantic_key(field_path) not in described
            and is_ai_assisted_field(field_path)
        ):
            tasks.append(_extra_ai_task(field_path, field))

    if not any(_is_category_field(item.field) for item in definitions):
        tasks.append(_category_task(effective, category_id))

    priority = {"invalid": 0, "confirm": 1, "fill": 2, "completed": 3}
    tasks.sort(key=lambda item: (priority[item.status], not item.required, item.label))
    counts = Counter(task.status for task in tasks)
    summary = FieldTaskSummary(
        completed=counts["completed"],
        confirm=counts["confirm"],
        fill=counts["fill"],
        invalid=counts["invalid"],
    )
    return FieldTaskResult(
        tasks=tasks,
        summary=summary,
        ready_to_draft=not any(task.blocking for task in tasks),
    )


def confirmable_ai_field(
    schema_data: dict[str, object] | str,
    field_path: str,
) -> SchemaFieldGuidance | None:
    guidance = build_schema_guidance(schema_data)
    target = _compact(field_path)
    for item in guidance.ai_fillable_fields:
        if _compact(item.field) == target:
            return item
    return None


def is_confirmable_category(field_path: str) -> bool:
    return _is_category_field(field_path)


def _task_from_guidance(
    guidance: SchemaFieldGuidance,
    fields: dict[str, DraftField],
) -> FieldTask:
    field = _resolve_field(fields, guidance.field)
    value = field.value if field is not None else None
    errors: list[str] = []
    has_value = _has_value(value)

    if not guidance.supported and (guidance.required or has_value):
        errors.append(guidance.support_message or "该 Alibaba 字段暂时无法安全填写")
    if field is not None and has_value and field.source not in guidance.allowed_sources:
        errors.append("当前数据来源不允许用于此字段")
    if guidance.type in {"singleCheck", "multiCheck"} and has_value and guidance.options:
        allowed = {option.value for option in guidance.options if option.valid}
        values = value if isinstance(value, list) else [value]
        if any(str(item) not in allowed for item in values):
            errors.append("当前值不在 Alibaba 返回的可选项中")
    if guidance.max_length and isinstance(value, str) and len(value) > guidance.max_length:
        errors.append(f"内容不能超过 {guidance.max_length} 个字符")

    status: FieldTaskStatus
    if errors:
        status = "invalid"
    elif (
        has_value
        and field is not None
        and (field.source in AI_SOURCES or field.requires_confirmation)
    ):
        status = "confirm"
    elif not has_value and guidance.required:
        status = "fill"
    else:
        status = "completed"

    copy = _field_copy(guidance)
    return FieldTask(
        field_path=guidance.field,
        parent_path=_parent_path(guidance.field),
        label=copy["label"],
        question=copy["question"],
        explanation=copy["explanation"],
        example=copy["example"],
        unit=copy["unit"],
        control_type=_control_type(guidance),
        status=status,
        responsibility=guidance.responsibility,
        responsibility_label=guidance.responsibility_label,
        allowed_sources=guidance.allowed_sources,
        value=value,
        display_value_zh=field.display_value_zh if field else None,
        source=field.source if field else None,
        confidence=field.confidence if field else None,
        evidence=field.evidence if field else None,
        required=guidance.required,
        blocking=guidance.required and status != "completed",
        validation_errors=errors,
        options=guidance.options,
        async_options=guidance.async_options,
        async_query_method=guidance.async_query_method,
        value_type=guidance.value_type,
        max_length=guidance.max_length,
        min_length=guidance.min_length,
        min_value=guidance.min_value,
        max_value=guidance.max_value,
        min_input_num=guidance.min_input_num,
        max_input_num=guidance.max_input_num,
        pattern=guidance.pattern,
        value_attributes=guidance.value_attributes,
        supported=guidance.supported,
        support_message=guidance.support_message,
        repeatable_group=guidance.repeatable_group,
        repeatable_groups=guidance.repeatable_groups,
    )


def _category_task(
    fields: dict[str, DraftField],
    category_id: str | None,
) -> FieldTask:
    field = get_listing_field(fields, "category_id") or get_listing_field(fields, "cat_id")
    value = field.value if field else None
    errors: list[str] = []
    status: FieldTaskStatus
    if field and field.source in AI_SOURCES:
        status = "confirm"
    elif not _has_value(value):
        status = "fill"
    elif category_id and str(value) != category_id:
        status = "invalid"
        errors.append("确认类目与当前实时 Schema 的类目不一致")
    else:
        status = "completed"
    return FieldTask(
        field_path="category_id",
        label="最终叶子类目",
        question="这个商品最终发布到哪个叶子类目？",
        explanation="类目决定 Alibaba 的全部必填字段和发布规则。",
        example="从 AI 建议中确认，或搜索并选择最具体的末级类目",
        control_type="category",
        status=status,
        responsibility="merchant",
        responsibility_label="客户确认",
        allowed_sources=[FieldSource.USER_CONFIRMED, FieldSource.USER_PROVIDED],
        value=value,
        display_value_zh=field.display_value_zh if field else None,
        source=field.source if field else None,
        confidence=field.confidence if field else None,
        evidence=field.evidence if field else None,
        required=True,
        blocking=status != "completed",
        validation_errors=errors,
    )


def _extra_ai_task(field_path: str, field: DraftField) -> FieldTask:
    label = field_path.replace("_", " ").strip().title()
    return FieldTask(
        field_path=field_path,
        parent_path=_parent_path(field_path),
        label=label,
        question=f"请确认“{label}”是否准确。",
        explanation="该内容由 AI 或图片识别生成，采用前必须核对。",
        control_type="textarea"
        if isinstance(field.value, str) and len(field.value) > 80
        else "text",
        status="confirm",
        responsibility="ai_candidate",
        responsibility_label="AI 候选·客户确认",
        allowed_sources=[
            FieldSource.IMAGE_EXTRACTED,
            FieldSource.AI_GENERATED,
            FieldSource.USER_CONFIRMED,
        ],
        value=field.value,
        display_value_zh=field.display_value_zh,
        source=field.source,
        confidence=field.confidence,
        evidence=field.evidence,
        required=False,
        blocking=True,
    )


def _field_copy(guidance: SchemaFieldGuidance) -> FieldCopy:
    text = _compact(f"{guidance.field}.{guidance.name or ''}")
    known: list[tuple[tuple[str, ...], FieldCopy]] = [
        (
            ("minorderquantity", "moq"),
            _copy(
                "最小起订量",
                "客户最少买多少件才能下单？",
                "查看报价单或 ERP 的最小起订量。",
                "100",
                "件",
            ),
        ),
        (
            ("grossweight", "packageweight"),
            _copy(
                "包装毛重",
                "每箱货连包装一共多重？",
                "查看装箱单中的毛重，不能使用商品净重。",
                "12.5",
                "kg",
            ),
        ),
        (
            ("packagesize", "packagedimension"),
            _copy(
                "包装尺寸",
                "一箱货包装后的长、宽、高是多少？",
                "查看装箱单或实际测量外箱。",
                "40 × 30 × 25",
                "cm",
            ),
        ),
        (
            ("leadtime", "deliverytime"),
            _copy("发货期", "收到订单后多少天可以发货？", "查看生产排期或现货承诺。", "7", "天"),
        ),
        (
            ("inventory", "stock"),
            _copy(
                "可售库存", "当前实际可以销售多少件？", "查看 ERP 库存或人工盘点结果。", "500", "件"
            ),
        ),
        (
            ("price", "fob"),
            _copy(
                "商品价格",
                "这个商品对客户的真实报价是多少？",
                "查看报价单或价格系统。",
                "9.99",
                None,
            ),
        ),
        (
            ("origin", "placeoforigin"),
            _copy("原产地", "这个商品实际在哪里生产？", "查看商品档案或报关资料。", "China", None),
        ),
        (
            ("hscode",),
            _copy(
                "HS Code",
                "这个商品使用哪个真实 HS Code？",
                "查看报关资料；不确定时咨询报关人员。",
                "960340",
                None,
            ),
        ),
        (
            ("certification", "certificate"),
            _copy(
                "认证信息",
                "这个商品有哪些可以提供证明的认证？",
                "只填写能够出示有效证书的认证。",
                "CE",
                None,
            ),
        ),
        (
            ("material", "composition"),
            _copy(
                "材质或成分",
                "这个商品的真实材质或成分是什么？",
                "查看 BOM、规格书或供应商资料。",
                "Stainless steel",
                None,
            ),
        ),
        (
            ("subject", "title"),
            _copy(
                "商品标题",
                "这个英文标题是否准确描述了商品？",
                "核对品类、核心属性，删除无法证明的宣传词。",
                None,
                None,
            ),
        ),
        (
            ("description",),
            _copy(
                "商品描述",
                "这段商品描述是否全部基于真实信息？",
                "重点核对性能、材质、认证和适用场景。",
                None,
                None,
            ),
        ),
        (
            ("keyword",),
            _copy(
                "搜索关键词",
                "这些关键词是否都与商品直接相关？",
                "删除品牌侵权词和商品不具备的属性。",
                None,
                None,
            ),
        ),
    ]
    for aliases, copy in known:
        if any(alias in text for alias in aliases):
            return copy
    label = guidance.name or guidance.field.rsplit(".", 1)[-1]
    return _copy(
        label,
        f"请提供“{label}”的真实信息。"
        if guidance.responsibility != "ai_candidate"
        else f"请确认“{label}”是否准确。",
        guidance.tip or guidance.responsibility_reason,
        None,
        None,
    )


def _copy(
    label: str,
    question: str,
    explanation: str,
    example: str | None,
    unit: str | None,
) -> FieldCopy:
    return {
        "label": label,
        "question": question,
        "explanation": explanation,
        "example": example,
        "unit": unit,
    }


def _control_type(guidance: SchemaFieldGuidance) -> str:
    text = _compact(f"{guidance.field}.{guidance.name or ''}")
    if guidance.async_options:
        return "async_select"
    if guidance.type == "multiCheck":
        return "multi_select"
    if guidance.type == "singleCheck" or guidance.options:
        return "select"
    if guidance.type == "multiInput":
        return "multi_value"
    if guidance.type == "complex":
        return "complex"
    if guidance.type == "multiComplex":
        return "multi_complex"
    if guidance.value_type == "date":
        return "date"
    if guidance.value_type == "url":
        return "url"
    if guidance.value_type in {"decimal", "integer", "long"}:
        return "number"
    if guidance.value_type in {"textarea", "html"}:
        return "textarea"
    if any(
        token in text
        for token in ("price", "weight", "quantity", "stock", "length", "width", "height", "time")
    ):
        return "number"
    if any(token in text for token in ("description", "detail", "sellingpoint")):
        return "textarea"
    return "text"


def _parent_path(field_path: str) -> str | None:
    parent, separator, _ = field_path.rpartition(".")
    return parent if separator else None


def _has_value(value: Any) -> bool:
    return value not in (None, "", [], {})


def _resolve_field(fields: dict[str, DraftField], field_path: str) -> DraftField | None:
    direct = get_listing_field(fields, field_path)
    if direct is not None:
        return direct
    parts = field_path.replace("/", ".").split(".")
    for split_at in range(len(parts) - 1, 0, -1):
        parent = get_listing_field(fields, ".".join(parts[:split_at]))
        if parent is None:
            continue
        values: list[Any] = [parent.value]
        for part in parts[split_at:]:
            next_values: list[Any] = []
            for value in values:
                candidates = value if isinstance(value, list) else [value]
                for candidate in candidates:
                    if isinstance(candidate, dict) and part in candidate:
                        next_values.append(candidate[part])
            values = next_values
        resolved = [value for value in values if _has_value(value)]
        if resolved:
            return DraftField(
                value=resolved if isinstance(parent.value, list) else resolved[0],
                source=parent.source,
                confidence=parent.confidence,
                evidence=parent.evidence,
                confirmation_id=parent.confirmation_id,
                confirmed_at=parent.confirmed_at,
                confirmed_by=parent.confirmed_by,
            )
    return None


def _compact(value: str) -> str:
    return "".join(char.lower() for char in value if char.isalnum())


def _semantic_key(field_path: str) -> str:
    compact = _compact(field_path)
    if "title" in compact or "subject" in compact:
        return "title"
    if "keyword" in compact:
        return "keywords"
    if "description" in compact or compact == "detail":
        return "description"
    return compact


def _is_category_field(field_path: str) -> bool:
    text = _compact(field_path)
    return text in {"categoryid", "catid", "category"}
