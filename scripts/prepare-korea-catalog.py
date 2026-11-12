"""Prepare a private SQL import from a confirmed Korea exhibition workbook."""

import argparse
import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import openpyxl


def sql_text(value):
    escaped = value.replace("\\", "\\\\").replace("'", "''")
    escaped = escaped.replace("\r", "\\r").replace("\n", "\\n")
    return "E'" + escaped + "'"


def image_urls(index_path, mirrored_images):
    mirrored = {}
    if mirrored_images:
        for file in sorted(mirrored_images.iterdir()):
            if file.is_file() and re.fullmatch(r"[\w-]+\.(?:jpe?g|png|webp)", file.name, re.I):
                mirrored.setdefault(file.stem, f"korea-product-images/{file.name}")
    matches = {}
    for name, file_id in json.loads(index_path.read_text(encoding="utf-8")):
        match = re.fullmatch(r"(.+?)(?:_(\d+))?\.(?:jpg|jpeg|png)", name, re.I)
        if not match or not re.fullmatch(r"[\w-]+", file_id):
            continue
        code = match[1].strip().casefold()
        rank = int(match[2] or 0)
        if code not in matches or rank < matches[code][0]:
            matches[code] = (rank, mirrored.get(file_id, f"https://drive.google.com/file/d/{file_id}/view"))
    return {code: url for code, (_, url) in matches.items()}


def product_code(value, number_format):
    if isinstance(value, int) and re.fullmatch("0+", number_format):
        return str(value).zfill(len(number_format))
    return str(value if value is not None else "").strip()


def parse_price(value, cell):
    try:
        price = Decimal(str(value).strip().replace(",", ""))
        if not price.is_finite() or price <= 0 or price >= 10**12:
            raise InvalidOperation
        return price.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        raise ValueError(f"{cell}: invalid price") from None


def read_products(args, images):
    workbook = openpyxl.load_workbook(args.workbook, read_only=True, data_only=True)
    try:
        sheet = workbook[args.sheet] if args.sheet else workbook.active
        headers = [str(cell.value or "").strip() for cell in sheet[args.header_row][:4]]
        if headers != ["品番", "商品名", "I列 × 1.65", "I列 × 1.7"]:
            raise ValueError("Expected product code, product name, 1.65 and 1.7 in columns A to D.")
        codes = set()
        for row_number, row in enumerate(
            sheet.iter_rows(min_row=args.header_row + 1, min_col=1, max_col=4),
            start=args.header_row + 1,
        ):
            code = product_code(row[0].value, row[0].number_format or "")
            name = str(row[1].value or "").strip()
            if not (code or name or row[2].value or row[3].value):
                continue
            if not code or not name:
                raise ValueError(f"Row {row_number}: missing product code or name")
            if code in codes:
                raise ValueError(f"A{row_number}: duplicate product code")
            codes.add(code)
            price165 = parse_price(row[2].value, f"C{row_number}")
            price170 = parse_price(row[3].value, f"D{row_number}")
            image = images.get(code.casefold())
            yield (
                sql_text(code),
                sql_text(name),
                str(price170),
                str(price165),
                sql_text(image) if image else "null",
                "true",
                str(row_number),
            )
    finally:
        workbook.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--sheet")
    parser.add_argument("--header-row", type=int, default=1)
    parser.add_argument("--images", type=Path, default=Path("private-data/korea-drive-images.json"))
    parser.add_argument("--mirrored-images", type=Path, help="Local inventory of files already uploaded to the private bucket, named by Drive file ID.")
    parser.add_argument("--out", type=Path, default=Path("private-data/korea-catalog.sql"))
    parser.add_argument("--register-event", action="store_true")
    args = parser.parse_args()
    rows = list(read_products(args, image_urls(args.images, args.mirrored_images)))
    if not rows:
        raise SystemExit("No orderable products in the workbook.")
    values = ",\n".join("(" + ",".join(row) + ")" for row in rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        "begin;\n"
        "set local lock_timeout = '5s';\n"
        "delete from public.korea_products;\n"
        "insert into public.korea_products "
        "(product_no, product_name, wholesale_price, wholesale_price_165, image_url, is_active, display_order) values\n"
        + values
        + ";\n"
        + (
            "insert into public.exhibitions(id,name,order_event_name,pickup_prefix) "
            "values ('korea_exhibition','韓国展示会','korea_exhibition','KR') "
            "on conflict (id) do nothing;\n"
            if args.register_event else ""
        )
        + "commit;\n",
        encoding="utf-8",
    )
    print(f"{len(rows)} product rows, {sum(row[4] != 'null' for row in rows)} matched images")


if __name__ == "__main__":
    main()
