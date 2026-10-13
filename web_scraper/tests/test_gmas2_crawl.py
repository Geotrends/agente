"""Recorrido y metadatos de GMAS2 con HTML real (T027; RF-C3-IV-01, IV-05, R9/R10)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

from scraper.config import ScraperConfig
from scraper.crawler import CrawlItem, SourceCrawler
from scraper.gmas2 import extraer_metadatos
from scraper.html_parser import parse_html
from scraper.sources import SOURCES

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "gmas2"
BASE = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento="


def fixture(nombre: str) -> str:
    return (FIXTURES / f"{nombre}.html").read_text(encoding="utf-8")


def crawler_gmas2(directory: str) -> SourceCrawler:
    source = SOURCES["gmas2_envigado"]
    config = ScraperConfig(
        start_url=source.start_urls[0], output_dir=Path(directory), source_name=source.name,
        legacy_flat_layout=False, mode=source.mode, allowed_paths=source.allowed_paths,
        extra_allowed_domains=source.allowed_domains, max_depth=source.max_depth,
        content_selectors=source.content_selectors, gmas2_recorrido=source.gmas2_recorrido,
    )
    crawler = SourceCrawler(config)
    crawler.robots.parse([])   # sin red: robots vacío = todo permitido
    return crawler


class MetadatosGmas2Tests(unittest.TestCase):
    def test_metadatos_de_gt_p_004(self) -> None:
        meta = extraer_metadatos(BeautifulSoup(fixture("GT-P-004"), "lxml"), BASE + "0000010207")
        self.assertEqual(meta["codigo"], "GT-P-004")
        self.assertEqual(meta["nombre"], "Procedimiento permisos y autorizaciones ambientales")
        self.assertEqual(meta["version"], "06")
        self.assertEqual(meta["fecha_actualizacion"], "2022-09-12")
        self.assertEqual(meta["estado"], "Vigente")
        self.assertEqual(meta["dependencia"], "SECRETARÍA DE MEDIO AMBIENTE Y DESARROLLO AGROPECUARIO")
        self.assertEqual(meta["id"], "0000010207")
        codigos = {v["codigo"] for v in meta["vinculados"]}
        self.assertEqual(codigos, {"MG-P-003", "MG-F-002", "MG-F-051", "GT-F-011", "GT-F-012"})
        mg051 = next(v for v in meta["vinculados"] if v["codigo"] == "MG-F-051")
        self.assertEqual(mg051["id"], "0000012522")
        self.assertEqual(mg051["grupo"], "Registros")
        self.assertTrue(mg051["url"].startswith(BASE))

    def test_estado_derogado(self) -> None:
        meta = extraer_metadatos(BeautifulSoup(fixture("MG-P-003"), "lxml"), BASE + "0000002961")
        self.assertEqual(meta["estado"], "Derogado")
        self.assertEqual(meta["codigo"], "MG-P-003")

    def test_descarga_de_un_formato(self) -> None:
        meta = extraer_metadatos(BeautifulSoup(fixture("GT-F-011"), "lxml"), BASE + "0000013830")
        self.assertTrue(meta["descarga"].startswith("https://gmas2.envigado.gov.co/gmas/downloadFile.public?"))


class RecorridoGmas2Tests(unittest.TestCase):
    def test_desde_un_gt_p_se_encolan_sus_vinculados(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            crawler = crawler_gmas2(directory)
            page = parse_html(fixture("GT-P-004"), BASE + "0000010207", SOURCES["gmas2_envigado"].content_selectors)
            hijos = crawler._build_children(CrawlItem(BASE + "0000010207", 0, ""), BASE + "0000010207", page.title, page.links)
            urls = {h.url for h in hijos}
            for doc_id in ("0000002961", "0000000475", "0000012522", "0000013830", "0000000392"):
                self.assertTrue(any(doc_id in u for u in urls), f"falta el vinculado {doc_id}")

    def test_desde_un_vinculado_solo_se_encolan_descargas(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            crawler = crawler_gmas2(directory)
            page = parse_html(fixture("GT-F-011"), BASE + "0000013830", SOURCES["gmas2_envigado"].content_selectors)
            links = page.links + [(BASE + "0000099999", "Otro documento del proceso")]
            hijos = crawler._build_children(CrawlItem(BASE + "0000013830", 1, BASE + "0000010207"), BASE + "0000013830", page.title, links)
            self.assertTrue(hijos, "la descarga del formato debe encolarse")
            for h in hijos:
                self.assertIn("downloadFile.public", h.url, f"desde un vinculado no se navega a {h.url}")


if __name__ == "__main__":
    unittest.main()
