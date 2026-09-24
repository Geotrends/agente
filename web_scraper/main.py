from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

from scraper import ScraperConfig, SourceCrawler
from scraper.config import MAX_FILE_SIZE_MB, REQUEST_TIMEOUT
from scraper.metadata_store import MetadataStore
from scraper.sources import SOURCES, SourceDefinition


def default_sources() -> list[str]:
    """Fuentes cuando no se pasa --sources: SCRAPER_SOURCES (la misma variable
    del .env que usa docker compose), o todas las registradas si no esta."""
    raw = os.environ.get("SCRAPER_SOURCES", "").split()
    if not raw:
        return sorted(SOURCES)
    unknown = [name for name in raw if name not in SOURCES]
    if unknown:
        raise SystemExit(
            f"SCRAPER_SOURCES tiene fuentes desconocidas: {' '.join(unknown)}. "
            f"Validas: {' '.join(sorted(SOURCES))}"
        )
    return raw


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Crawler multi-fuente para el corpus documental institucional "
        "(Ambientometro, Concejo de Envigado, MinAmbiente, MinAgricultura, Envigado.gov.co, GMAS2)",
    )
    parser.add_argument("--output", required=True, type=Path, help="Carpeta raiz compartida por todas las fuentes")
    parser.add_argument(
        "--sources", nargs="+", choices=sorted(SOURCES), default=None,
        help="Fuentes a procesar en esta corrida (por defecto: SCRAPER_SOURCES, o todas si no esta definida)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="No descarga ni guarda nada; solo registra la decision CRAWL/DOWNLOAD/SKIP de cada URL",
    )
    parser.add_argument("--start-url", default=None, help="Solo valido junto con --sources de una unica fuente")
    parser.add_argument("--max-depth", type=int, default=None)
    parser.add_argument("--timeout", type=float, default=None)
    parser.add_argument("--delay", type=float, default=None, help="Sobrescribe el delay propio de cada fuente")
    parser.add_argument("--max-file-size-mb", type=int, default=None)
    parser.add_argument("--max-pages", type=int, help="Limite opcional por fuente, util para pruebas")
    parser.add_argument(
        "--no-related-seeds", action="store_true",
        help="No agregar semillas/secciones relacionadas de ninguna fuente seleccionada",
    )
    parser.add_argument("--no-verify-ssl", action="store_true", help="Solo para diagnostico; no recomendado")
    return parser


def build_config(source: SourceDefinition, args: argparse.Namespace) -> ScraperConfig:
    primary_start, *extra_starts = source.start_urls
    if args.start_url and len(args.sources) == 1:
        primary_start = args.start_url
    related_seeds = () if args.no_related_seeds else (*extra_starts, *source.related_seed_urls)
    kwargs: dict[str, object] = dict(
        start_url=primary_start,
        output_dir=args.output,
        source_name=source.name,
        legacy_flat_layout=source.legacy_flat_layout,
        mode=source.mode,
        allowed_paths=source.allowed_paths,
        document_folder_mode=source.document_folder_mode,
        min_relevance_score=source.min_relevance_score,
        high_priority_keywords=source.high_priority_keywords,
        blacklist_keywords=source.blacklist_keywords,
        document_exclude_phrases=source.document_exclude_phrases,
        allowed_document_types=source.allowed_document_types,
        min_document_year=source.min_document_year,
        content_selectors=source.content_selectors,
        document_allowed_domains=source.document_allowed_domains,
        ca_bundle=source.ca_bundle,
        render_js=source.render_js,
        title_selectors=source.title_selectors,
        title_code_selector=source.title_code_selector,
        require_selector_text=source.require_selector_text,
        require_text_values=source.require_text_values,
        dry_run=args.dry_run,
        max_depth=args.max_depth if args.max_depth is not None else source.max_depth,
        request_timeout=args.timeout if args.timeout is not None else REQUEST_TIMEOUT,
        delay_between_requests=args.delay if args.delay is not None else source.delay,
        max_file_size_mb=args.max_file_size_mb if args.max_file_size_mb is not None else MAX_FILE_SIZE_MB,
        max_pages=args.max_pages,
        verify_ssl=not args.no_verify_ssl,
        related_seed_urls=related_seeds,
        extra_allowed_domains=source.allowed_domains,
    )
    if source.user_agent:
        kwargs["user_agent"] = source.user_agent
    return ScraperConfig(**kwargs)


def print_report(manifests: dict[str, dict[str, object]], output_dir: Path, dry_run: bool) -> None:
    print("\n===================================================")
    print("SCRAPING COMPLETADO" if not dry_run else "DRY-RUN COMPLETADO (nada se descargo)")
    print("===================================================\n")

    if "ambientometro" in manifests:
        manifest = manifests["ambientometro"]
        print("AMBIENTOMETRO")
        print(f"Paginas visitadas:      {manifest['pages_visited']}")
        print(f"Documentos evaluados:   {manifest['documents_found']}")
        print(f"Documentos descargados: {manifest['documents_downloaded']}")
        print(f"Markdown guardado:      {manifest['pages_saved_as_markdown']}")
        print()

    if "concejo_envigado" in manifests:
        manifest = manifests["concejo_envigado"]
        by_type = manifest.get("by_document_type", {})
        print("CONCEJO ENVIGADO")
        labels = {
            "acuerdo": "Acuerdos", "decreto": "Decretos",
            "resolucion": "Resoluciones", "circular": "Circulares",
            "manual": "Manuales", "politica": "Politicas",
            "plan": "Planes", "ley": "Leyes", "otros": "Otros",
        }
        ordered_types = [*labels, *(key for key in sorted(by_type) if key not in labels)]
        for document_type in ordered_types:
            count = int(by_type.get(document_type, 0))
            if count or document_type in {"acuerdo", "decreto", "resolucion", "otros"}:
                print(f"{labels.get(document_type, document_type.replace('_', ' ').title()) + ':':<15}{count}")
        print(f"{'Total:':<15}{sum(int(value) for value in by_type.values())}")
        print()

    for key, label in (("minambiente", "MINAMBIENTE"), ("minagricultura", "MINAGRICULTURA")):
        if key not in manifests:
            continue
        manifest = manifests[key]
        print(label)
        print(f"Documentos evaluados:   {manifest['documents_found']}")
        print(f"Descargados:            {manifest['documents_downloaded']}")
        print(f"Descartados por filtro: {manifest['documents_skipped_filter']}")
        print()

    for key, label in (("envigado_com", "ENVIGADO.GOV.CO"), ("gmas2_envigado", "GMAS2 ENVIGADO")):
        if key not in manifests:
            continue
        manifest = manifests[key]
        print(label)
        print(f"Paginas visitadas:      {manifest['pages_visited']}")
        print(f"Markdown guardado:      {manifest['pages_saved_as_markdown']}")
        print()

    total_duplicates = sum(int(m["duplicates_skipped"]) for m in manifests.values())
    total_errors = sum(int(m["errors"]) for m in manifests.values())
    print(f"Duplicados globales: {total_duplicates}")
    print(f"Errores:             {total_errors}")
    print(f"\nSalida:\n{output_dir}")
    print("===================================================")


def main() -> int:
    args = build_parser().parse_args()
    if args.sources is None:
        args.sources = default_sources()
    if args.start_url and len(args.sources) != 1:
        print(
            "Aviso: --start-url se ignora porque --sources tiene mas de una fuente.",
            file=sys.stderr,
        )

    output_dir = Path(args.output).expanduser().resolve()
    metadata = MetadataStore(output_dir)  # compartida: da deduplicacion cruzada entre fuentes
    manifests: dict[str, dict[str, object]] = {}
    for source_name in args.sources:
        source = SOURCES[source_name]
        config = build_config(source, args)
        manifest = SourceCrawler(config, metadata=metadata).crawl()
        manifests[source_name] = manifest

    if not args.dry_run:
        metadata.write_manifest({
            "generated_at": datetime.now().astimezone().isoformat(),
            "output_dir": str(output_dir),
            "sources": manifests,
        })

    print_report(manifests, output_dir, args.dry_run)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrumpido por el usuario", file=sys.stderr)
        raise SystemExit(130)
