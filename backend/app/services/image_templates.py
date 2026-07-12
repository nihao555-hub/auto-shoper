from backend.app.models import (
    ImageInputRequirement,
    ImagePromptTemplate,
    ImageSlot,
    ImageSlotPlan,
    ProductImageGenerationRequest,
)

SLOT_TEMPLATES: dict[ImageSlot, ImagePromptTemplate] = {
    "main": ImagePromptTemplate(
        slot="main",
        label="主图",
        schema_field="scImages",
        required=True,
        instruction=(
            "Create an Alibaba.com MAIN IMAGE designed to maximize qualified clicks: pure white "
            "background, one complete product centered and filling the frame, crisp edges, "
            "balanced studio lighting, accurate color, and no props, added text, watermark, "
            "border, badge, or decorative element."
        ),
    ),
    "detail": ImagePromptTemplate(
        slot="detail",
        label="详情图",
        schema_field="detailImage",
        required=True,
        instruction=(
            "Create an Alibaba.com DETAIL IMAGE designed to increase buyer confidence: use a "
            "clean close-up composition to show only construction, texture, finish, components, "
            "and workmanship that are visibly supported by the reference product."
        ),
    ),
    "scenario": ImagePromptTemplate(
        slot="scenario",
        label="场景图",
        schema_field="scImages",
        required=False,
        instruction=(
            "Create an Alibaba.com SCENARIO IMAGE designed to help the intended buyer imagine "
            "using the product. Place the exact product in the supplied realistic use scenario "
            "with a commercially attractive composition and no unsupported performance claim."
        ),
    ),
    "specification": ImagePromptTemplate(
        slot="specification",
        label="规格图",
        schema_field=None,
        required=False,
        instruction=(
            "Create an Alibaba.com SPECIFICATION IMAGE designed to reduce purchase uncertainty. "
            "Use a restrained technical layout and add only the exact confirmed dimensions "
            "supplied in the product facts or user input; never estimate or invent measurements."
        ),
    ),
    "packaging": ImagePromptTemplate(
        slot="packaging",
        label="包装图",
        schema_field=None,
        required=False,
        instruction=(
            "Create an Alibaba.com PACKAGING IMAGE designed to reassure wholesale buyers. Show "
            "the exact product with the supplied real packaging configuration, without inventing "
            "boxes, labels, quantities, certifications, shipping marks, or packaging claims."
        ),
    ),
}

DEFAULT_SLOTS: tuple[ImageSlot, ...] = (
    "main",
    "detail",
    "scenario",
    "specification",
    "packaging",
)

SLOT_PURPOSES: dict[ImageSlot, str] = {
    "main": "白底突出商品本体，提升搜索结果点击率",
    "detail": "展示真实纹理与做工，降低买家疑虑",
    "scenario": "展示目标买家的真实使用场景，增强购买想象",
    "specification": "用已确认尺寸减少询盘前的信息不确定性",
    "packaging": "展示真实包装与装箱信息，增强批发采购信任",
}

SCENARIO_REQUIREMENT = ImageInputRequirement(
    key="use_scenario",
    label="目标使用场景 / 目标人群",
    description="例如：艺术学生在画室进行水彩练习。AI 不会自行编造产品用途。",
)
SPECIFICATION_REQUIREMENT = ImageInputRequirement(
    key="product_dimensions",
    label="已确认的商品尺寸",
    description="例如：9 × 12 in（只填写真实、已核对的尺寸和单位）。",
)
PACKAGING_REQUIREMENT = ImageInputRequirement(
    key="packaging_details",
    label="已确认的包装信息",
    description="填写真实包装形式、包装尺寸或每箱装量；缺少时不生成包装图。",
)


def list_prompt_templates() -> list[ImagePromptTemplate]:
    return list(SLOT_TEMPLATES.values())


def resolve_slots(requested: list[ImageSlot]) -> list[ImageSlot]:
    if not requested:
        return list(DEFAULT_SLOTS)
    seen: set[ImageSlot] = set()
    ordered: list[ImageSlot] = []
    for slot in requested:
        if slot in SLOT_TEMPLATES and slot not in seen:
            seen.add(slot)
            ordered.append(slot)
    return ordered or list(DEFAULT_SLOTS)


def _has_all(values: tuple[str, ...]) -> bool:
    return all(value.strip() for value in values)


def build_slot_plan(
    template: ImagePromptTemplate,
    request: ProductImageGenerationRequest,
) -> ImageSlotPlan:
    missing: list[ImageInputRequirement] = []
    if template.slot == "scenario" and not request.user_inputs.get("use_scenario", "").strip():
        missing.append(SCENARIO_REQUIREMENT)
    elif template.slot == "specification" and not (
        _has_all(
            (
                request.facts.product_length,
                request.facts.product_width,
                request.facts.product_height,
            )
        )
        or request.user_inputs.get("product_dimensions", "").strip()
    ):
        missing.append(SPECIFICATION_REQUIREMENT)
    elif template.slot == "packaging" and not (
        _has_all(
            (
                request.facts.package_length,
                request.facts.package_width,
                request.facts.package_height,
            )
        )
        or request.facts.units_per_carton.strip()
        or request.user_inputs.get("packaging_details", "").strip()
    ):
        missing.append(PACKAGING_REQUIREMENT)
    return ImageSlotPlan(
        slot=template.slot,
        label=template.label,
        purpose=SLOT_PURPOSES[template.slot],
        required=template.required,
        can_generate=not missing,
        missing_user_inputs=missing,
    )


def _confirmed_facts(request: ProductImageGenerationRequest) -> list[str]:
    values: list[str] = []
    simple_facts = (
        ("Brand", request.facts.brand),
        ("Model", request.facts.model),
        ("Material", request.facts.material),
        ("Origin", request.facts.origin),
    )
    values.extend(f"{label}: {value.strip()}" for label, value in simple_facts if value.strip())
    if _has_all(
        (
            request.facts.product_length,
            request.facts.product_width,
            request.facts.product_height,
        )
    ):
        values.append(
            "Product dimensions: "
            f"{request.facts.product_length} × {request.facts.product_width} × "
            f"{request.facts.product_height} cm"
        )
    if _has_all(
        (
            request.facts.package_length,
            request.facts.package_width,
            request.facts.package_height,
        )
    ):
        values.append(
            "Package dimensions: "
            f"{request.facts.package_length} × {request.facts.package_width} × "
            f"{request.facts.package_height} cm"
        )
    if request.facts.units_per_carton.strip():
        values.append(f"Units per carton: {request.facts.units_per_carton.strip()}")
    return values


def build_slot_prompt(
    template: ImagePromptTemplate,
    request: ProductImageGenerationRequest,
) -> str:
    confirmed_facts = "; ".join(_confirmed_facts(request))
    keywords = "、".join(request.keywords[:8])
    parts = [
        template.instruction,
        "Primary objective: maximize qualified buyer interest and conversion while preserving "
        "the exact product identity and never inventing product, commercial, or compliance facts.",
        f"Product title: {request.title or 'not supplied'}.",
        f"Category: {request.category or 'not supplied'}.",
        f"Product description: {request.description or 'not supplied'}.",
        f"Keywords: {keywords or 'not supplied'}.",
        f"Confirmed facts: {confirmed_facts or 'not supplied'}.",
    ]
    if template.slot == "scenario":
        parts.append(
            f"Required use scenario: {request.user_inputs.get('use_scenario', '').strip()}."
        )
    elif template.slot == "specification":
        dimensions = request.user_inputs.get("product_dimensions", "").strip()
        if dimensions:
            parts.append(f"Confirmed product dimensions supplied by the user: {dimensions}.")
    elif template.slot == "packaging":
        packaging = request.user_inputs.get("packaging_details", "").strip()
        if packaging:
            parts.append(f"Confirmed packaging information supplied by the user: {packaging}.")
    parts.append(
        "Text policy: do not render invented marketing copy. Preserve text already printed on "
        "the reference product exactly as-is. Only the specification image may add labels for "
        f"confirmed measurements, and those labels must use {request.target_language} English."
    )
    if request.extra_prompt.strip():
        parts.append(f"Additional direction: {request.extra_prompt.strip()}")
    return " ".join(parts)
