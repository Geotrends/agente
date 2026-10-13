"""Alcance de las fuentes (T026; RF-C3-IV-01, anticipa RF-C3-AD-15)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scraper.config import ScraperConfig
from scraper.crawler import CrawlItem, SourceCrawler
from scraper.run_report import RunReport
from scraper.sources import GMAS2_DOCUMENT_IDS, HOSTS_PERMITIDOS, SOURCES, host_permitido

CONFIG_BACKEND = Path(__file__).resolve().parents[2] / "backend" / "config" / "base-conocimiento.json"


class AlcanceDeFuentesTests(unittest.TestCase):
    def test_solo_las_cuatro_fuentes_autorizadas(self) -> None:
        self.assertEqual(
            sorted(SOURCES),
            ["ambientometro", "envigado_com", "gmas2_envigado", "observatorio_geotrends"],
        )

    def test_los_seis_procedimientos_incluyen_gt_p_029(self) -> None:
        self.assertIn("0000004622", GMAS2_DOCUMENT_IDS)
        self.assertEqual(len(GMAS2_DOCUMENT_IDS), 6)

    def test_hosts_permitidos_identicos_a_la_configuracion_del_backend(self) -> None:
        backend = json.loads(CONFIG_BACKEND.read_text(encoding="utf-8"))["hosts_permitidos"]
        self.assertEqual(
            sorted((h["host"], h["tipo"]) for h in backend),
            sorted(HOSTS_PERMITIDOS),
            "la lista de Python y la del backend deben ser idénticas",
        )

    def test_host_permitido(self) -> None:
        self.assertTrue(host_permitido("https://gmas2.envigado.gov.co/gmas/x"))
        self.assertTrue(host_permitido("https://ambientometroenvigado.com/calidad-del-aire/"))
        self.assertFalse(host_permitido("http://ambientometroenvigado.com/"))
        self.assertFalse(host_permitido("https://www.minambiente.gov.co/"))
        self.assertFalse(host_permitido("https://envigado.gov.co.evil.com/"))

    def test_enlace_fuera_de_la_lista_se_reporta_y_no_se_descarga(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = ScraperConfig(
                start_url="https://ambientometroenvigado.com/observatorio/", output_dir=Path(directory),
                source_name="ambientometro", legacy_flat_layout=False,
                document_allowed_domains=("descargas.ejemplo.org",),
            )
            report = RunReport(fuentes=["ambientometro"])
            crawler = SourceCrawler(config, report=report)
            item = CrawlItem(config.start_url, 0, "")
            children = crawler._build_children(
                item, config.start_url, "Observatorio",
                [("https://descargas.ejemplo.org/informe.pdf", "Informe")],
            )
            self.assertEqual(children, [], "no se encola: el host no está en la lista permitida")
            enlace = next(e for e in report.enlaces if e.url == "https://descargas.ejemplo.org/informe.pdf")
            self.assertEqual(enlace.resultado, "error")
            self.assertEqual(enlace.error.tipo, "fuera_de_alcance")


if __name__ == "__main__":
    unittest.main()
