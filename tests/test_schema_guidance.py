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


def test_guidance_exposes_category_image_size_limit() -> None:
    schema = (
        "<itemSchema>"
        '<field id="scImages" name="Main images" type="complex">'
        '<rules><rule name="maxImageSizeRule" value="4194304"/></rules>'
        '<fields><field id="scImages_0" type="input"/></fields>'
        "</field>"
        "</itemSchema>"
    )

    assert build_schema_guidance(schema).main_image_max_size_bytes == 4194304


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


def test_guidance_reuses_account_box_options_for_sku_packaging() -> None:
    schema = """
    <itemSchema>
      <field id="boxPackaging" name="Box gauge" type="multiCheck">
        <options><option displayName="Carton A" value="33070036" /></options>
      </field>
      <field id="logisticsSku" type="multiComplex">
        <fields>
          <field id="boxPackagingSku" name="Box gauge sku" type="multiCheck">
            <rules><rule name="valueTypeRule" value="long" /></rules>
          </field>
        </fields>
      </field>
    </itemSchema>
    """

    guidance = build_schema_guidance(schema)
    field = next(
        item
        for item in guidance.manual_fact_fields
        if item.field == "logisticsSku.boxPackagingSku"
    )

    assert field.supported is True
    assert [(option.display_name, option.value) for option in field.options] == [
        ("Carton A", "33070036")
    ]


def test_guidance_supports_alibaba_double_inputs() -> None:
    schema = (
        "<itemSchema>"
        '<field id="fob" type="complex"><fields>'
        '<field id="range_min" type="input">'
        '<rules><rule name="requiredRule" value="true"/>'
        '<rule name="valueTypeRule" value="double"/></rules>'
        "</field></fields></field>"
        "</itemSchema>"
    )

    field = build_schema_guidance(schema).manual_fact_fields[0]

    assert field.field == "fob.range_min"
    assert field.value_type == "double"
    assert field.supported is True


def test_platform_managed_product_feature_is_not_rendered_as_a_merchant_task() -> None:
    schema = (
        "<itemSchema>"
        '<field id="productFeature" type="multiCheck">'
        '<rules><rule name="requiredRule" value="true"/></rules>'
        "</field>"
        "</itemSchema>"
    )
    guidance = build_schema_guidance(schema)

    assert guidance.ai_fillable_fields == []
    assert guidance.manual_fact_fields == []


def test_platform_status_and_empty_schema_containers_are_not_seller_inputs() -> None:
    schema = (
        "<itemSchema>"
        '<field id="productQuality" type="complex"><fields>'
        '<field id="productQuality_score" type="input"/>'
        "</fields></field>"
        '<field id="supportLogisticsSku" type="singleCheck"/>'
        '<field id="ApiPostLevelAttrAdapter" type="multiInput"/>'
        '<field id="multilangInfo" type="multiComplex"><fields/></field>'
        "</itemSchema>"
    )

    guidance = build_schema_guidance(schema)

    assert guidance.ai_fillable_fields == []
    assert guidance.manual_fact_fields == []


def test_guidance_prompt_lists_options_and_manual_fields() -> None:
    guidance = build_schema_guidance(SCHEMA_XML)
    prompt = render_guidance_prompt(guidance)
    assert "AI-fillable fields:" in prompt
    assert "icbuCatProp.p-use" in prompt
    assert "Office=1" in prompt
    assert "Never fill these human/business fact fields" in prompt


def test_guidance_returns_all_options_but_keeps_large_enum_out_of_ai_prompt() -> None:
    options = "".join(
        f'<option displayName="Option {index}" value="v{index}"/>'
        for index in range(65)
    )
    schema = (
        "<itemSchema>"
        '<field id="productTitle" name="Product title" type="singleCheck">'
        f"<options>{options}</options>"
        "</field>"
        "</itemSchema>"
    )
    guidance = build_schema_guidance(schema)
    field = guidance.ai_fillable_fields[0]

    assert len(field.options) == 65
    assert field.options[-1].value == "v64"
    prompt = render_guidance_prompt(guidance)
    assert "65 allowed options are available in the UI" in prompt
    assert "Option 64=v64" not in prompt
    assert "omit this field from AI output" in prompt


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
