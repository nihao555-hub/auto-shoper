from backend.app.models import ProductImageFacts, ProductImageGenerationRequest
from backend.app.services.image_templates import (
    SLOT_TEMPLATES,
    build_slot_prompt,
    resolve_slots,
)
from backend.app.services.schema_guidance import (
    build_schema_guidance,
    render_guidance_prompt,
)

SCHEMA_XML = (
    "<itemSchema>"
    '<field id="productTitle" name="Product name" type="input">'
    '<rules><rule name="requiredRule" value="true"/>'
    '<rule name="maxLengthRule" value="128" unit="character"/></rules></field>'
    '<field id="icbuCatProp" name="Product feature" type="complex"><fields>'
    '<field id="p-material" name="Body Material" type="singleCheck">'
    '<rules><rule name="requiredRule" value="true"/></rules>'
    '<options><option displayName="Paper" value="3291889"/>'
    '<option displayName="Wood" value="3963577"/></options></field>'
    '<field id="p-use" name="Use" type="singleCheck">'
    '<options><option displayName="Office" value="1"/></options></field>'
    "</fields></field>"
    '<field id="price" name="Price" type="input">'
    '<rules><rule name="requiredRule" value="true"/></rules></field>'
    "</itemSchema>"
)


def test_build_schema_guidance_separates_ai_and_manual_fields() -> None:
    guidance = build_schema_guidance(SCHEMA_XML)
    ai_fields = {field.field: field for field in guidance.ai_fillable_fields}
    manual_fields = {field.field for field in guidance.manual_fact_fields}

    assert "productTitle" in ai_fields
    assert ai_fields["productTitle"].max_length == 128
    assert "icbuCatProp.p-use" in ai_fields
    # price is a business/human fact the AI must not guess.
    assert "price" in manual_fields


def test_guidance_prompt_lists_options_and_manual_fields() -> None:
    guidance = build_schema_guidance(SCHEMA_XML)
    prompt = render_guidance_prompt(guidance)
    assert "AI-fillable fields:" in prompt
    assert "icbuCatProp.p-use" in prompt
    assert "Office=1" in prompt
    assert "Never fill these human/business fact fields" in prompt


def test_build_schema_guidance_handles_missing_schema() -> None:
    guidance = build_schema_guidance(None)
    assert guidance.ai_fillable_fields == []
    assert render_guidance_prompt(guidance) == ""


def test_resolve_slots_defaults_and_filters() -> None:
    assert resolve_slots([]) == ["main", "detail", "scenario"]
    assert resolve_slots(["detail", "detail", "main"]) == ["detail", "main"]


def test_build_slot_prompt_includes_extra_direction() -> None:
    request = ProductImageGenerationRequest(
        product_id="p1",
        title="Watercolor Paper Pad",
        category="Paper",
        description="",
        keywords=["watercolor", "paper"],
        facts=ProductImageFacts(brand="Acme", origin="China"),
        extra_prompt="soft daylight",
    )
    prompt = build_slot_prompt(SLOT_TEMPLATES["main"], request)
    assert "white background" in prompt
    assert "Watercolor Paper Pad" in prompt
    assert "soft daylight" in prompt
    assert "品牌=Acme" in prompt
