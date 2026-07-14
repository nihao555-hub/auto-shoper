from backend.app.models import ProductImageFacts, ProductImageGenerationRequest
from backend.app.services.image_templates import (
    SLOT_TEMPLATES,
    build_slot_plan,
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
    assert ai_fields["productTitle"].responsibility == "ai_candidate"
    assert "icbuCatProp.p-use" in ai_fields
    assert "icbuCatProp.p-material" in manual_fields
    # price is a business/human fact the AI must not guess.
    assert "price" in manual_fields
    material = next(
        field
        for field in guidance.manual_fact_fields
        if field.field == "icbuCatProp.p-material"
    )
    assert material.responsibility == "business_system"


def test_unknown_schema_fields_default_to_merchant_not_ai() -> None:
    schema = (
        "<itemSchema>"
        '<field id="categorySpecificDeclaration" name="Special declaration" type="input">'
        '<rules><rule name="requiredRule" value="true"/></rules>'
        "</field>"
        "</itemSchema>"
    )
    guidance = build_schema_guidance(schema)

    assert guidance.ai_fillable_fields == []
    assert guidance.manual_fact_fields[0].responsibility == "merchant"
    assert guidance.manual_fact_fields[0].responsibility_label == "客户填写"


def test_legal_description_does_not_become_ai_owned_by_name_collision() -> None:
    schema = (
        "<itemSchema>"
        '<field id="patentDescription" name="Patent description" type="input">'
        '<rules><rule name="requiredRule" value="true"/></rules>'
        "</field>"
        "</itemSchema>"
    )
    guidance = build_schema_guidance(schema)

    assert guidance.ai_fillable_fields == []
    assert guidance.manual_fact_fields[0].responsibility == "merchant"


def test_origin_is_a_product_fact_not_an_automatic_store_default() -> None:
    schema = (
        "<itemSchema>"
        '<field id="placeOfOrigin" name="Place of origin" type="singleCheck">'
        '<rules><rule name="requiredRule" value="true"/></rules>'
        '<options><option displayName="China" value="CN"/></options>'
        "</field>"
        "</itemSchema>"
    )
    field = build_schema_guidance(schema).manual_fact_fields[0]

    assert field.responsibility == "business_system"


def test_guidance_marks_async_choice_fields() -> None:
    schema = (
        "<itemSchema>"
        '<field id="supplyType" name="Supply type" type="singleCheck">'
        "<rules>"
        '<rule name="requiredRule" value="true"/>'
        '<rule name="asyncQueryRule" value="top.category.options.get"/>'
        "</rules>"
        "</field>"
        "</itemSchema>"
    )
    field = build_schema_guidance(schema).manual_fact_fields[0]

    assert field.async_options is True
    assert field.async_query_method == "top.category.options.get"


def test_optionless_ai_looking_choice_defaults_to_merchant() -> None:
    schema = (
        "<itemSchema>"
        '<field id="productFeature" type="multiCheck">'
        '<rules><rule name="requiredRule" value="true"/></rules>'
        "</field>"
        "</itemSchema>"
    )
    guidance = build_schema_guidance(schema)

    assert guidance.ai_fillable_fields == []
    field = guidance.manual_fact_fields[0]
    assert field.responsibility == "merchant"
    assert "未返回可安全提交的选项" in field.responsibility_reason


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
    assert resolve_slots([]) == ["main", "detail", "scenario", "specification", "packaging"]
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
    assert "Brand: Acme" in prompt
    assert "MAIN IMAGE" in prompt
    assert "maximize qualified buyer interest" in prompt
    # Shared guardrails are always present.
    assert "do not invent" in prompt
    assert "Avoid blur" in prompt
    # Main slot uses the strict pixel-faithful fidelity clause.
    assert "pixel-faithful" in prompt


def test_slot_plan_requests_only_facts_needed_for_each_image_type() -> None:
    request = ProductImageGenerationRequest(
        product_id="p1",
        title="Watercolor Paper Pad",
        category="Paper",
        description="",
    )
    main = build_slot_plan(SLOT_TEMPLATES["main"], request)
    scenario = build_slot_plan(SLOT_TEMPLATES["scenario"], request)
    specification = build_slot_plan(SLOT_TEMPLATES["specification"], request)
    packaging = build_slot_plan(SLOT_TEMPLATES["packaging"], request)

    assert main.can_generate is True
    assert scenario.missing_user_inputs[0].key == "use_scenario"
    assert specification.missing_user_inputs[0].key == "product_dimensions"
    assert packaging.missing_user_inputs[0].key == "packaging_details"

    ready_request = request.model_copy(
        update={
            "user_inputs": {
                "use_scenario": "Artists painting in a studio",
                "product_dimensions": "9 × 12 in",
                "packaging_details": "12 pads per export carton",
            }
        }
    )
    assert build_slot_plan(SLOT_TEMPLATES["scenario"], ready_request).can_generate is True
    assert build_slot_plan(SLOT_TEMPLATES["specification"], ready_request).can_generate is True
    assert build_slot_plan(SLOT_TEMPLATES["packaging"], ready_request).can_generate is True


def test_build_slot_prompt_surfaces_confirmed_dimensions_only_when_complete() -> None:
    complete = ProductImageGenerationRequest(
        product_id="p1",
        title="Paint Brush",
        category="Art Supplies",
        description="",
        keywords=[],
        facts=ProductImageFacts(
            brand="Acme",
            product_length="10",
            product_width="2",
            product_height="2",
        ),
    )
    partial = ProductImageGenerationRequest(
        product_id="p1",
        title="Paint Brush",
        category="Art Supplies",
        description="",
        keywords=[],
        # Only one axis supplied -> must not emit a partial "× × cm" fragment.
        facts=ProductImageFacts(brand="Acme", product_length="10"),
    )
    spec_complete = build_slot_prompt(SLOT_TEMPLATES["specification"], complete)
    spec_partial = build_slot_prompt(SLOT_TEMPLATES["specification"], partial)
    assert "Product dimensions: 10 × 2 × 2 cm" in spec_complete
    assert "Product dimensions" not in spec_partial
    assert "Confirmed facts: Brand: Acme." in spec_partial


def test_build_slot_prompt_applies_per_slot_fidelity() -> None:
    request = ProductImageGenerationRequest(
        product_id="p1",
        title="Paint Brush",
        category="Art Supplies",
        description="",
        keywords=[],
        facts=ProductImageFacts(brand="Acme"),
    )
    main_prompt = build_slot_prompt(SLOT_TEMPLATES["main"], request)
    scenario_prompt = build_slot_prompt(SLOT_TEMPLATES["scenario"], request)
    # Main image locks the whole product; only background/lighting may change.
    assert "only the background" in main_prompt
    # Scenario image intentionally allows the surroundings to change.
    assert "only the surrounding environment" in scenario_prompt
    # Both still carry the shared compliance guardrail.
    assert "certification mark" in main_prompt
    assert "certification mark" in scenario_prompt


def test_build_slot_prompt_injects_visible_traits() -> None:
    request = ProductImageGenerationRequest(
        product_id="p1",
        title="Paint Brush",
        category="Art Supplies",
        description="",
        keywords=[],
        facts=ProductImageFacts(brand="Acme"),
        visible_traits=["red wooden handle", "  ", "three bristle tufts"],
    )
    prompt = build_slot_prompt(SLOT_TEMPLATES["main"], request)
    assert "Preserve these traits observed on the reference product" in prompt
    assert "red wooden handle; three bristle tufts" in prompt
