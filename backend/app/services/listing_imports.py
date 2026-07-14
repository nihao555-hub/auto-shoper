from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections.abc import Iterable, Mapping
from xml.etree import ElementTree

from backend.app.models import DraftField, FieldSource, ListingImportResult, ListingImportRow

MAX_XLSX_ENTRIES = 200
MAX_XLSX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024

HEADER_ALIASES = {
    "reference": {"reference", "sku", "商品编码", "产品编码", "货号"},
    "subject": {"subject", "title", "product_title", "英文标题", "标题", "产品标题"},
    "category_id": {"category_id", "cat_id", "类目id", "类目 ID", "叶子类目"},
    "brand": {"brand", "品牌"},
    "model": {"model", "型号"},
    "material": {"material", "材质"},
    "price": {"price", "unit_price", "价格", "单价"},
    "moq": {"moq", "minimum_order_quantity", "最小起订量", "起订量"},
    "inventory": {"inventory", "stock", "库存", "可售库存"},
    "lead_time": {"lead_time", "交期", "发货天数"},
    "origin": {"origin", "原产地", "产地"},
    "hs_code": {"hs_code", "hscode", "海关编码"},
    "certifications": {"certifications", "certificates", "认证", "证书"},
    "gross_weight": {"gross_weight", "毛重", "包装毛重"},
    "package_length": {"package_length", "包装长"},
    "package_width": {"package_width", "包装宽"},
    "package_height": {"package_height", "包装高"},
    "sku_rows": {"sku_rows", "skus", "sku列表", "sku 明细"},
}


def _normalized_header(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip()).lower()
    for canonical, aliases in HEADER_ALIASES.items():
        if text in {alias.lower() for alias in aliases}:
            return canonical
    return str(value or "").strip()


def _cell_value(value: object) -> object:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return ""
    if stripped[:1] in {"[", "{"}:
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return stripped
    return stripped


def _rows_to_result(
    rows: Iterable[Mapping[str, object]],
    *,
    format_name: str,
) -> ListingImportResult:
    imported: list[ListingImportRow] = []
    errors: list[str] = []
    for row_number, raw_row in enumerate(rows, start=2):
        normalized = {
            _normalized_header(key): _cell_value(value)
            for key, value in raw_row.items()
            if str(key).strip()
        }
        reference = str(normalized.pop("reference", "")).strip()
        if not reference:
            errors.append(f"第 {row_number} 行缺少商品编码，已跳过")
            continue
        values = {key: value for key, value in normalized.items() if value not in (None, "", [])}
        warnings: list[str] = []
        if "certifications" in values and isinstance(values["certifications"], str):
            values["certifications"] = [
                item.strip()
                for item in re.split(r"[,，;；|]", values["certifications"])
                if item.strip()
            ]
        if "sku_rows" in values and not isinstance(values["sku_rows"], list):
            warnings.append("SKU 明细不是 JSON 数组，已按原始文本导入并等待人工修正")
        imported.append(
            ListingImportRow(
                row_number=row_number,
                reference=reference,
                fields={
                    key: DraftField(value=value, source=FieldSource.BUSINESS_SYSTEM)
                    for key, value in values.items()
                },
                warnings=warnings,
            )
        )
    return ListingImportResult(format=format_name, rows=imported, errors=errors)  # type: ignore[arg-type]


def _decode_csv(data: bytes) -> str:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("CSV 编码无法识别，请另存为 UTF-8 或 GB18030")


def _parse_csv(data: bytes) -> list[dict[str, object]]:
    reader = csv.DictReader(io.StringIO(_decode_csv(data)))
    if not reader.fieldnames:
        raise ValueError("CSV 缺少表头")
    return [dict(row) for row in reader]


def _xlsx_text(node: ElementTree.Element, shared_strings: list[str]) -> str:
    namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    cell_type = node.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(item.text or "" for item in node.iter(f"{namespace}t"))
    value = node.find(f"{namespace}v")
    raw = value.text if value is not None and value.text is not None else ""
    if cell_type == "s" and raw.isdigit():
        index = int(raw)
        return shared_strings[index] if index < len(shared_strings) else ""
    return raw


def _xlsx_column(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference.upper())
    if not letters:
        return 0
    result = 0
    for letter in letters.group(0):
        result = result * 26 + ord(letter) - ord("A") + 1
    return result - 1


def _parse_xlsx(data: bytes) -> list[dict[str, object]]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_XLSX_ENTRIES:
            raise ValueError("XLSX 文件包含过多内部文件")
        if sum(item.file_size for item in entries) > MAX_XLSX_UNCOMPRESSED_BYTES:
            raise ValueError("XLSX 解压后超过 25 MB 限制")
        if any(".." in item.filename.split("/") for item in entries):
            raise ValueError("XLSX 包含非法路径")
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
            shared_strings = [
                "".join(text.text or "" for text in item.iter(f"{namespace}t"))
                for item in root.iter(f"{namespace}si")
            ]
        sheet_names = sorted(
            name
            for name in archive.namelist()
            if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)
        )
        if not sheet_names:
            raise ValueError("XLSX 中没有工作表")
        root = ElementTree.fromstring(archive.read(sheet_names[0]))
    namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    matrix: list[list[str]] = []
    for row in root.iter(f"{namespace}row"):
        values: list[str] = []
        for cell in row.findall(f"{namespace}c"):
            column = _xlsx_column(cell.attrib.get("r", "A1"))
            while len(values) <= column:
                values.append("")
            values[column] = _xlsx_text(cell, shared_strings)
        matrix.append(values)
    if not matrix:
        raise ValueError("XLSX 工作表为空")
    headers = matrix[0]
    return [
        {headers[index]: value for index, value in enumerate(row) if index < len(headers)}
        for row in matrix[1:]
        if any(value.strip() for value in row)
    ]


def _parse_erp_json(data: bytes) -> list[dict[str, object]]:
    try:
        payload = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("ERP JSON 不是有效的 UTF-8 JSON 文件") from exc
    if isinstance(payload, dict):
        payload = payload.get("items", payload.get("products", payload.get("rows")))
    if not isinstance(payload, list):
        raise ValueError("ERP JSON 顶层必须是数组，或包含 items/products/rows 数组")
    return [dict(item) for item in payload if isinstance(item, dict)]


def parse_listing_import(filename: str, data: bytes) -> ListingImportResult:
    suffix = filename.rsplit(".", maxsplit=1)[-1].lower() if "." in filename else ""
    if suffix == "csv":
        return _rows_to_result(_parse_csv(data), format_name="csv")
    if suffix == "xlsx":
        return _rows_to_result(_parse_xlsx(data), format_name="xlsx")
    if suffix == "json":
        return _rows_to_result(_parse_erp_json(data), format_name="erp_json")
    raise ValueError("仅支持 .csv、.xlsx 和 .json 导入文件")
