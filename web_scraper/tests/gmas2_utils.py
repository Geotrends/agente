"""Utilidades de las pruebas que ejercitan el crawler de GMAS2 sin red."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from scraper.config import ScraperConfig
from scraper.crawler import CrawlItem, SourceCrawler
from scraper.run_report import RunReport
from scraper.sources import SOURCES

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "gmas2"
BASE = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento="


def fixture(nombre: str) -> str:
    return (FIXTURES / f"{nombre}.html").read_text(encoding="utf-8")


def crawler_gmas2(directory: str, umbral: float = 0.3) -> SourceCrawler:
    source = SOURCES["gmas2_envigado"]
    config = ScraperConfig(
        start_url=source.start_urls[0], output_dir=Path(directory), source_name=source.name,
        legacy_flat_layout=False, mode=source.mode, allowed_paths=source.allowed_paths,
        extra_allowed_domains=source.allowed_domains, max_depth=source.max_depth,
        content_selectors=source.content_selectors, title_selectors=source.title_selectors,
        title_code_selector=source.title_code_selector,
        require_selector_text=source.require_selector_text, require_text_values=source.require_text_values,
        gmas2_recorrido=source.gmas2_recorrido, umbral_estructura=umbral,
    )
    crawler = SourceCrawler(config, report=RunReport(fuentes=[source.name]))
    crawler.robots.parse([])
    return crawler


def guardar(crawler: SourceCrawler, doc_id: str, html: str, profundidad: int = 0):
    """Pasa una página por `_save_page` como si el servidor la hubiera devuelto."""
    url = BASE + doc_id
    respuesta = SimpleNamespace(url=url, status_code=200)
    hijos = crawler._save_page(CrawlItem(url, profundidad, ""), respuesta, html)  # type: ignore[arg-type]
    return url, hijos


def enlace(crawler: SourceCrawler, url: str):
    return next(e for e in crawler.report.enlaces if e.url == url)
