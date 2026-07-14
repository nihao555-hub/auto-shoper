from backend.app.store_routes import (
    _extract_count,
    _first_product_id,
    _template_defaults,
)


def test_extracts_official_product_list_count_and_id() -> None:
    payload = {
        "result": {
            "total_item": 12,
            "products": {
                "alibaba_product_brief_response": [
                    {
                        "product_id": 123456,
                        "group_id": 88,
                        "group_name": "Best sellers",
                    }
                ]
            },
        }
    }

    assert _extract_count(payload) == 12
    assert _first_product_id(payload) == "123456"


def test_builds_template_defaults_from_store_payloads() -> None:
    product_payloads = [
        {
            "product": {
                "group_id": 88,
                "group_name": "Best sellers",
                "currency": "USD",
                "price_unit": "Sets",
                "warehouse_id": 7,
                "warehouse_name": "Main warehouse",
                "freight_template_id": 9,
                "freight_template_name": "Standard shipping",
                "inventory_code": "CN_MAIN",
            }
        }
    ]
    photobank_payload = {
        "photobank_groups": [{"id": 66, "name": "Auto Shoper"}],
    }

    defaults = _template_defaults(
        product_payloads,
        photobank_payload,
        {
            "company_profile": "Brush manufacturer",
            "brand": "Studio Line",
            "origin": "China",
        },
    )

    assert defaults == {
        "currency": "USD",
        "priceUnit": "Sets",
        "productGroupId": "88",
        "productGroupLabel": "Best sellers",
        "photoBankGroupId": "66",
        "photoBankGroupLabel": "Auto Shoper",
        "warehouseId": "7",
        "warehouseLabel": "Main warehouse",
        "shippingTemplateId": "9",
        "shippingTemplateLabel": "Standard shipping",
        "inventoryCode": "CN_MAIN",
        "companyProfile": "Brush manufacturer",
        "brand": "Studio Line",
        "origin": "China",
    }


def test_builds_template_defaults_from_live_product_detail_keys() -> None:
    defaults = _template_defaults(
        [
            {
                "product": {
                    "groupId": 802404593,
                    "groupName": "Paint Color",
                    "wholesaleTrade": {
                        "unitType": "Set",
                        "shippingLineTemplateId": 2003860290,
                    },
                    "productSku": {
                        "skus": [
                            {
                                "inventoryDTOList": [
                                    {"inventory": 360, "storeCode": "CN_LOCAL_01"}
                                ]
                            }
                        ]
                    },
                }
            }
        ],
        {"photobank_groups": [{"id": 30011581628, "name": "AI images"}]},
        {"company_profile": "", "brand": "", "origin": ""},
    )

    assert defaults == {
        "priceUnit": "Set",
        "productGroupId": "802404593",
        "productGroupLabel": "Paint Color",
        "photoBankGroupId": "30011581628",
        "photoBankGroupLabel": "AI images",
        "shippingTemplateId": "2003860290",
        "inventoryCode": "CN_LOCAL_01",
    }
