import argparse
import sys

try:
    import segno
except ImportError:
    print("Установите зависимости: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser(description="PNG с QR по строке маркировки СКИТ (для печати и теста сканера).")
    p.add_argument("payload", nargs="?", help="Строка для кодирования (если нет — пример товара)")
    p.add_argument("-o", "--output", default="marking.png", help="Файл PNG")
    p.add_argument("--scale", type=int, default=8, help="Масштаб пикселей на модуль")
    args = p.parse_args()
    text = args.payload or (
        "type=item$org=SK$ver=1$wh=WHM1$loc=A03-S02-B04$gtin=04607138960662$qty=24$lot=L240430$uid=BX000128"
    )
    q = segno.make(text, error="m")
    q.save(args.output, scale=args.scale, dark="#1a1a1a", light="#ffffff")
    print(args.output)


if __name__ == "__main__":
    main()
