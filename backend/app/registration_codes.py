import argparse
import csv
import hashlib
import os
import secrets
import string
from pathlib import Path

from backend.app.config import get_settings
from backend.app.database import Database


def generate_registration_codes(
    *,
    count: int,
    min_length: int,
    max_length: int,
) -> list[str]:
    if count < 1:
        raise ValueError("注册码数量必须大于 0")
    if min_length < 8 or max_length < min_length:
        raise ValueError("注册码长度范围无效")
    lengths = [
        min_length + index % (max_length - min_length + 1)
        for index in range(count)
    ]
    secrets.SystemRandom().shuffle(lengths)
    codes: set[str] = set()
    for length in lengths:
        code = "".join(secrets.choice(string.ascii_letters) for _ in range(length))
        while code in codes:
            code = "".join(secrets.choice(string.ascii_letters) for _ in range(length))
        codes.add(code)
    return list(codes)


def write_registration_codes(path: Path, codes: list[str]) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["registration_code"])
        writer.writerows((code,) for code in codes)


def read_registration_codes(path: Path) -> list[str]:
    with path.open(encoding="utf-8", newline="") as source:
        rows = csv.DictReader(source)
        if rows.fieldnames != ["registration_code"]:
            raise ValueError("注册码 CSV 表头无效")
        codes = [row["registration_code"] for row in rows]
    if not codes or len(codes) != len(set(codes)):
        raise ValueError("注册码 CSV 为空或包含重复值")
    if any(not code.isascii() or not code.isalpha() for code in codes):
        raise ValueError("注册码只能包含大小写英文字母")
    return codes


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成并写入一次性注册码")
    parser.add_argument("--count", type=int, default=10_000)
    parser.add_argument("--min-length", type=int, default=16)
    parser.add_argument("--max-length", type=int, default=32)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--output", type=Path)
    source.add_argument("--input", type=Path)
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    if args.input:
        codes = read_registration_codes(args.input)
        source_path = args.input
    else:
        codes = generate_registration_codes(
            count=args.count,
            min_length=args.min_length,
            max_length=args.max_length,
        )
        write_registration_codes(args.output, codes)
        source_path = args.output
    code_hashes = [hashlib.sha256(code.encode()).hexdigest() for code in codes]
    database = Database(get_settings())
    inserted = database.add_registration_code_hashes(code_hashes)
    matched = database.count_registration_code_hashes(code_hashes)
    if matched != len(codes):
        raise RuntimeError(f"数据库仅匹配 {matched}/{len(codes)} 个注册码")
    total, available = database.registration_code_counts()
    print(
        f"本次新增 {inserted} 个注册码，确认匹配 {matched} 个；"
        f"数据库总数 {total}，可用 {available}；明文文件：{source_path}"
    )


if __name__ == "__main__":
    main()
