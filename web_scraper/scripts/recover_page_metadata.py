"""Reconstruye en paginas.csv la metadata perdida por el hallazgo A-7.

Antes de la correccion de scraper.metadata_store, cada corrida sobre una
fuente nueva reescribia paginas.csv solo con las paginas de esa corrida y
borraba titulo y URL de las demas. Este script recupera lo que se puede
recuperar SIN volver a rastrear ningun sitio: html_parser.markdown_document
ya escribe title, source_url, scraped_at y category en el frontmatter YAML de
cada .md, y ese frontmatter sobrevivio aunque el catalogo no.

Se corre UNA VEZ, sobre un arbol ya existente, desde web_scraper/ (igual que
main.py, un script plano, no un modulo con -m):

    python scripts/recover_page_metadata.py --output ../backend/data

Es aditivo, no destructivo: usa la misma MetadataStore que usa el crawler, asi
que cualquier fila que YA este en paginas.csv (por local_md_path) se conserva
tal cual y solo se agregan filas para los .md que no tenian ninguna.

Lo que NO se puede recuperar honestamente, y se deja en blanco a proposito en
vez de inventarse: profundidad de rastreo (depth), codigo HTTP de la respuesta
original, si se sospechaba contenido dinamico, y el hash de contenido — el que
guarda paginas.csv es del TEXTO EXTRAIDO DEL HTML original (ver
html_parser.parse_html), no del .md ya escrito, y ese HTML ya no existe.
Dejarlo vacio es lo correcto: al quedar vacio, _load_existing_pages
simplemente no lo agrega a known_page_hashes, en vez de participar en una
deduplicacion futura con un valor que nunca podria coincidir con nada real.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper.metadata_store import MetadataStore  # noqa: E402

# Inversa de la funcion quote() en html_parser.markdown_document: un valor
# entre comillas dobles, con \\ y \" como unicos escapes admitidos.
_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
_FIELD = re.compile(r'^([a-z_]+):\s*"((?:[^"\\]|\\.)*)"\s*$')


def parse_frontmatter(text: str) -> dict[str, str]:
    """Extrae los pares clave/valor del frontmatter YAML de un .md del scraper.

    No es un parser YAML general: el formato que escribe markdown_document es
    siempre "clave: \"valor con escapes\"", una linea por campo, asi que basta
    con deshacer exactamente los dos escapes que esa funcion introduce.
    """
    match = _FRONTMATTER.match(text)
    if not match:
        return {}
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        field_match = _FIELD.match(line)
        if not field_match:
            continue
        key, raw_value = field_match.groups()
        # quote() escapa primero "\" -> "\\" y despues '"' -> '\"'; se deshace
        # en el orden inverso para no interpretar dos veces la misma barra.
        value = raw_value.replace('\\"', '"').replace("\\\\", "\\")
        fields[key] = value
    return fields


def find_pages(output_dir: Path) -> list[Path]:
    return sorted(output_dir.glob("*/paginas_md/**/*.md"))


def recover(output_dir: Path) -> tuple[int, int, list[Path]]:
    """Agrega a paginas.csv una fila por cada .md que no tenia ninguna.

    Devuelve (filas_agregadas, filas_ya_existentes, archivos_sin_frontmatter).
    """
    store = MetadataStore(output_dir)
    already = {row.get("local_md_path", "") for row in store.rows["paginas"]}
    kept = len(already)

    added = 0
    unparsed: list[Path] = []
    for md_path in find_pages(output_dir):
        local_path = md_path.relative_to(output_dir).as_posix()
        if local_path in already:
            continue

        segments = local_path.split("/")
        source = segments[0]
        # "<source>/paginas_md/<categoria>/<archivo>.md"
        path_category = segments[2] if len(segments) >= 4 else ""

        text = md_path.read_text(encoding="utf-8")
        fields = parse_frontmatter(text)
        if not fields.get("title") or not fields.get("source_url"):
            unparsed.append(md_path)
            continue

        store.add("paginas", {
            "id": f"page-{len(store.rows['paginas']) + 1:06d}",
            "title": fields["title"],
            "url": fields["source_url"],
            "local_md_path": local_path,
            "category": fields.get("category") or path_category,
            "depth": "",
            "http_status": "",
            "content_length": len(text.encode("utf-8")),
            "content_sha256": "",
            "scraped_at": fields.get("scraped_at", ""),
            "dynamic_suspected": "",
            "source": source,
        })
        added += 1

    store.flush()
    return added, kept, unparsed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--output", required=True, type=Path,
        help="Carpeta raiz compartida por todas las fuentes (la misma que --output del crawler)",
    )
    args = parser.parse_args(argv)

    added, kept, unparsed = recover(args.output)
    print(f"[recover] {kept} filas ya existian en paginas.csv y se conservaron intactas.")
    print(f"[recover] {added} filas nuevas reconstruidas desde el frontmatter de los .md.")
    if unparsed:
        print(f"[recover] {len(unparsed)} archivo(s) .md sin frontmatter valido (revisar a mano):")
        for path in unparsed:
            print(f"           {path.relative_to(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
