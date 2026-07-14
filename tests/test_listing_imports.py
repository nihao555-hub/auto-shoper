import io
import json
import zipfile

import pytest

from backend.app.models import FieldSource
from backend.app.services.listing_imports import parse_listing_import


def test_csv_import_normalizes_business_fields_and_warnings() -> None:
    csv_data = (
        "商品编码,英文标题,价格,库存,认证\nSKU-1,Steel Brush,12.5,80,CE；RoHS\n,Skipped,1,2,\n"
    )
    result = parse_listing_import(
        "products.csv",
        csv_data.encode(),
    )

    assert result.format == "csv"
    assert len(result.rows) == 1
    assert result.rows[0].reference == "SKU-1"
    assert result.rows[0].fields["subject"].value == "Steel Brush"
    assert result.rows[0].fields["price"].source is FieldSource.BUSINESS_SYSTEM
    assert result.rows[0].fields["certifications"].value == ["CE", "RoHS"]
    assert result.errors == ["第 3 行缺少商品编码，已跳过"]


def test_erp_json_accepts_items_envelope_and_sku_rows() -> None:
    payload = {
        "items": [
            {
                "sku": "ERP-9",
                "title": "Imported product",
                "skus": [{"sku": "ERP-9-RED", "price": "8.2", "stock": 10}],
            }
        ]
    }

    result = parse_listing_import("erp.json", json.dumps(payload).encode())

    assert result.format == "erp_json"
    assert result.rows[0].fields["sku_rows"].value == [
        {"sku": "ERP-9-RED", "price": "8.2", "stock": 10}
    ]


def test_xlsx_import_reads_first_sheet_without_external_dependency() -> None:
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <sheetData>
                <row r="1">
                  <c r="A1" t="inlineStr"><is><t>商品编码</t></is></c>
                  <c r="B1" t="inlineStr"><is><t>标题</t></is></c>
                </row>
                <row r="2">
                  <c r="A2" t="inlineStr"><is><t>XLSX-1</t></is></c>
                  <c r="B2" t="inlineStr"><is><t>Workbook product</t></is></c>
                </row>
              </sheetData>
            </worksheet>""",
        )

    result = parse_listing_import("products.xlsx", content.getvalue())

    assert result.format == "xlsx"
    assert result.rows[0].reference == "XLSX-1"
    assert result.rows[0].fields["subject"].value == "Workbook product"


def test_import_rejects_unknown_extension() -> None:
    with pytest.raises(ValueError, match="仅支持"):
        parse_listing_import("products.xls", b"legacy")
