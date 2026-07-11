from backend.app.models import (
    ImagePromptTemplate,
    ImageSlot,
    ProductImageGenerationRequest,
)

SLOT_TEMPLATES: dict[ImageSlot, ImagePromptTemplate] = {
    "main": ImagePromptTemplate(
        slot="main",
        label="主图",
        schema_field="scImages",
        required=True,
        instruction=(
            "Re-render the reference product as a clean Alibaba.com main image: pure white "
            "background, product centered and filling the frame, even studio lighting, no "
            "added text, watermark, props, or decorative elements."
        ),
    ),
    "detail": ImagePromptTemplate(
        slot="detail",
        label="详情图",
        schema_field="detailImage",
        required=True,
        instruction=(
            "Re-render the reference product as a close-up detail image that highlights its "
            "visible construction, texture, and finish in a clean product-detail composition."
        ),
    ),
    "scenario": ImagePromptTemplate(
        slot="scenario",
        label="场景图",
        schema_field="scImages",
        required=False,
        instruction=(
            "Place the same reference product into a realistic, category-appropriate use "
            "scenario with a calm commercial lifestyle composition."
        ),
    ),
    "specification": ImagePromptTemplate(
        slot="specification",
        label="规格图",
        schema_field=None,
        required=False,
        instruction=(
            "Present the reference product in a restrained specification layout. Only add "
            "dimension callouts for dimensions explicitly supplied in the confirmed facts; "
            "never invent measurements."
        ),
    ),
    "packaging": ImagePromptTemplate(
        slot="packaging",
        label="包装图",
        schema_field=None,
        required=False,
        instruction=(
            "Show a realistic packaging and shipment presentation of the reference product "
            "without inventing labels, certifications, or packaging claims."
        ),
    ),
}

DEFAULT_SLOTS: tuple[ImageSlot, ...] = ("main", "detail", "scenario")


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


def build_slot_prompt(
    template: ImagePromptTemplate,
    request: ProductImageGenerationRequest,
) -> str:
    fact_values = [
        f"品牌={request.facts.brand}",
        f"型号={request.facts.model}",
        f"材质={request.facts.material}",
        f"商品尺寸={request.facts.product_length}×{request.facts.product_width}×"
        f"{request.facts.product_height} cm",
        f"包装尺寸={request.facts.package_length}×{request.facts.package_width}×"
        f"{request.facts.package_height} cm",
        f"原产地={request.facts.origin}",
    ]
    confirmed_facts = "；".join(value for value in fact_values if not value.endswith("="))
    keywords = "、".join(request.keywords[:8])
    parts = [
        template.instruction,
        f"Product title: {request.title or 'not supplied'}.",
        f"Category: {request.category or 'not supplied'}.",
        f"Keywords: {keywords or 'not supplied'}.",
        f"Confirmed facts: {confirmed_facts or 'not supplied'}.",
    ]
    if request.extra_prompt.strip():
        parts.append(f"Additional direction: {request.extra_prompt.strip()}")
    return " ".join(parts)
