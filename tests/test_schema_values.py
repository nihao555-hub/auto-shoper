from xml.etree import ElementTree

from backend.app.services.schema_values import build_schema_xml, validate_filled_schema_xml

SCHEMA_XML = """
<itemSchema>
  <field id="productTitle" type="input">
    <rules>
      <rule name="requiredRule" value="true"/>
      <rule name="maxLengthRule" value="20"/>
    </rules>
  </field>
  <field id="priceUnit" type="singleCheck">
    <rules><rule name="requiredRule" value="true"/></rules>
    <options>
      <option displayName="Piece" value="100000015"/>
    </options>
  </field>
  <field id="scImages" type="multiInput">
    <rules>
      <rule name="requiredRule" value="true"/>
      <rule name="valueAttributeRule" value="fileId"/>
      <rule name="maxInputNumRule" value="6"/>
    </rules>
  </field>
  <field id="shippingTemplate" type="complex">
    <fields>
      <field id="templateType" type="singleCheck">
        <rules><rule name="requiredRule" value="true"/></rules>
        <options><option value="aliLogistics"/></options>
      </field>
      <field id="shippingTemplateId" type="input">
        <rules><rule name="requiredRule" value="true"/></rules>
      </field>
    </fields>
  </field>
  <field id="sku" type="multiComplex">
    <fields>
      <field id="price" type="input">
        <rules>
          <rule name="requiredRule" value="true"/>
          <rule name="regexRule" value="([0-9]{1,9})(\\.[0-9]{1,2})?"/>
        </rules>
      </field>
      <field id="props" type="multiInput">
        <rules>
          <rule name="requiredRule" value="true"/>
          <rule name="valueAttributeRule" value="propId"/>
          <rule name="valueAttributeRule" value="propValueId"/>
        </rules>
      </field>
    </fields>
  </field>
</itemSchema>
"""


def test_build_schema_xml_fills_official_value_shapes() -> None:
    result = build_schema_xml(
        SCHEMA_XML,
        {
            "productTitle": "Artist brush",
            "priceUnit": "100000015",
            "scImages": [
                {
                    "value": "https://example.test/photo.jpg",
                    "attributes": {"fileId": "987"},
                }
            ],
            "shippingTemplate": {
                "templateType": "aliLogistics",
                "shippingTemplateId": "42",
            },
            "sku": [
                {
                    "price": "1.25",
                    "props": [
                        {
                            "value": "191288010:-1",
                            "attributes": {
                                "propId": "191288010",
                                "propValueId": "-1",
                            },
                        }
                    ],
                },
                {
                    "price": "1.10",
                    "props": [
                        {
                            "value": "191288010:100",
                            "attributes": {
                                "propId": "191288010",
                                "propValueId": "100",
                            },
                        }
                    ],
                },
            ],
        },
    )

    assert result.ready_to_submit is True
    assert result.errors == []
    root = ElementTree.fromstring(result.xml)
    title = next(field for field in root.findall("field") if field.attrib["id"] == "productTitle")
    assert title.findtext("value") == "Artist brush"
    images = next(field for field in root.findall("field") if field.attrib["id"] == "scImages")
    image_value = images.find("values/value")
    assert image_value is not None
    assert image_value.attrib["fileId"] == "987"
    sku = next(field for field in root.findall("field") if field.attrib["id"] == "sku")
    assert len(sku.findall("complex-values")) == 2
    assert sku.findall("complex-values")[1].findtext("field[@id='price']/value") == "1.10"


def test_build_schema_xml_enforces_dynamic_rules_and_conditional_children() -> None:
    result = build_schema_xml(
        SCHEMA_XML,
        {
            "productTitle": "A title that is much too long",
            "priceUnit": "unsupported",
            "scImages": ["https://example.test/photo.jpg"],
            "shippingTemplate": {"templateType": "aliLogistics"},
        },
    )

    issues = {(issue.field, issue.rule) for issue in result.errors}
    assert result.ready_to_submit is False
    assert ("productTitle", "maxLengthRule") in issues
    assert ("priceUnit", "optionRule") in issues
    assert ("scImages", "valueAttributeRule") in issues
    assert ("shippingTemplate.shippingTemplateId", "requiredRule") in issues
    assert not any(issue.field.startswith("sku.") for issue in result.errors)


def test_build_schema_xml_rejects_unknown_fields() -> None:
    result = build_schema_xml(
        SCHEMA_XML,
        {
            "productTitle": "Artist brush",
            "priceUnit": "100000015",
            "scImages": [{"value": "photo", "attributes": {"fileId": "1"}}],
            "shippingTemplate": {
                "templateType": "aliLogistics",
                "shippingTemplateId": "42",
            },
            "notInSchema": "value",
        },
    )
    assert any(issue.rule == "unknownField" for issue in result.errors)


def test_validate_filled_schema_xml_rechecks_submission_values() -> None:
    built = build_schema_xml(
        SCHEMA_XML,
        {
            "productTitle": "Artist brush",
            "priceUnit": "100000015",
            "scImages": [{"value": "photo", "attributes": {"fileId": "1"}}],
            "shippingTemplate": {
                "templateType": "aliLogistics",
                "shippingTemplateId": "42",
            },
        },
    )
    validated = validate_filled_schema_xml(built.xml)
    assert validated.ready_to_submit is True
    assert validated.errors == []

    invalid = validate_filled_schema_xml(SCHEMA_XML)
    assert invalid.ready_to_submit is False
    assert {issue.field for issue in invalid.errors} >= {
        "productTitle",
        "priceUnit",
        "scImages",
        "shippingTemplate.templateType",
    }
