"""Lista de enlaces administrada desde el panel (SPEC007, RF-C3-AD-16..18)."""

from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from pathlib import Path

from main import build_config
from scraper.enlaces import NOMBRE_SNAPSHOT, cargar_snapshot, esta_quitada
from scraper.sources import SOURCES

A = "https://ambientometroenvigado.com"


def _snapshot(directorio: Path, links: list[dict], removed: list[str] | None = None) -> None:
    ruta = directorio / NOMBRE_SNAPSHOT
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps({
        "version": 7, "hash": "h" * 64, "links": links, "removed": removed or [],
        "createdAt": "2026-10-11T00:00:00Z", "configHash": "c" * 64,
    }), encoding="utf-8")


def _args(**extra: object) -> argparse.Namespace:
    base = dict(
        output=Path("."), sources=["ambientometro"], dry_run=True, start_url=None, max_depth=None, timeout=None,
        delay=None, max_file_size_mb=None, max_pages=None, no_related_seeds=False, no_verify_ssl=False,
    )
    base.update(extra)
    return argparse.Namespace(**base)


class SnapshotDeEnlacesTests(unittest.TestCase):
    def test_sin_snapshot_usa_las_semillas_estaticas(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(cargar_snapshot(Path(d)))
            config = build_config(SOURCES["ambientometro"], _args(), None)
            self.assertEqual(config.start_url, "https://ambientometroenvigado.com/observatorio/")
            self.assertIn("https://ambientometroenvigado.com/biblioteca-boletines/", config.related_seed_urls)

    def test_el_snapshot_define_las_semillas_y_excluye_lo_quitado(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            directorio = Path(d)
            _snapshot(directorio, [
                {"url": f"{A}/observatorio/", "source": "ambientometro", "direction": "secretaria_general"},
                {"url": f"{A}/nuevo-enlace/", "source": "ambientometro", "direction": "ecosistemas"},
            ], removed=[f"{A}/biblioteca-boletines/"])
            snap = cargar_snapshot(directorio)
            assert snap is not None
            self.assertEqual(snap.version, 7)
            config = build_config(SOURCES["ambientometro"], _args(), snap)
            self.assertEqual(config.start_url, f"{A}/observatorio/")
            self.assertEqual(config.related_seed_urls, (f"{A}/nuevo-enlace/",))
            self.assertEqual(config.urls_excluidas, (f"{A}/biblioteca-boletines/",))

    def test_un_host_no_permitido_en_el_snapshot_se_ignora(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            _snapshot(Path(d), [
                {"url": "https://www.minambiente.gov.co/x", "source": "ambientometro", "direction": "secretaria_general"},
                {"url": "http://ambientometroenvigado.com/x", "source": "ambientometro", "direction": "secretaria_general"},
            ])
            snap = cargar_snapshot(Path(d))
            assert snap is not None
            self.assertEqual(snap.vigentes, {})

    def test_snapshot_corrupto_se_trata_como_ausente(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / NOMBRE_SNAPSHOT
            ruta.parent.mkdir(parents=True)
            ruta.write_text("{no es json", encoding="utf-8")
            self.assertIsNone(cargar_snapshot(Path(d)))

    def test_esta_quitada_reconoce_el_enlace_y_su_camino(self) -> None:
        quitados = (f"{A}/biblioteca-boletines/",)
        self.assertTrue(esta_quitada(f"{A}/biblioteca-boletines", quitados))
        self.assertTrue(esta_quitada(f"{A}/biblioteca-boletines/2025/abril", quitados))
        self.assertTrue(esta_quitada(f"{A.upper()}/biblioteca-boletines/", quitados))
        self.assertFalse(esta_quitada(f"{A}/biblioteca-boletines-otros/", quitados))
        self.assertFalse(esta_quitada(f"{A}/observatorio/", quitados))


class SemillasInicialesTests(unittest.TestCase):
    def test_las_semillas_del_backend_son_las_estaticas_del_scraper(self) -> None:
        config = Path(__file__).resolve().parents[2] / "backend" / "config" / "base-conocimiento.json"
        iniciales = json.loads(config.read_text(encoding="utf-8"))["enlaces_iniciales"]
        del_backend = sorted((e["fuente"], e["url"]) for e in iniciales)
        del_scraper = sorted(
            (nombre, url)
            for nombre, fuente in SOURCES.items()
            for url in (*fuente.start_urls, *fuente.related_seed_urls)
        )
        self.assertEqual(del_backend, del_scraper)


class RastreadorOmiteEnlacesQuitadosTests(unittest.TestCase):
    def test_el_rastreador_no_encola_ni_reporta_un_enlace_quitado(self) -> None:
        from scraper.config import ScraperConfig
        from scraper.crawler import CrawlItem, SourceCrawler
        from scraper.run_report import RunReport

        with tempfile.TemporaryDirectory() as directory:
            config = ScraperConfig(
                start_url=f"{A}/observatorio/", output_dir=Path(directory), source_name="ambientometro",
                legacy_flat_layout=False, urls_excluidas=(f"{A}/biblioteca-boletines/",),
            )
            report = RunReport(fuentes=["ambientometro"])
            crawler = SourceCrawler(config, report=report)
            item = CrawlItem(config.start_url, 0, "")
            hijos = crawler._build_children(
                item, config.start_url, "Observatorio",
                [(f"{A}/biblioteca-boletines/2025/", "Boletines"), (f"{A}/calidad-del-aire/", "Calidad del aire")],
            )
            urls = [h.url for h in hijos]
            self.assertNotIn(f"{A}/biblioteca-boletines/2025/", urls)
            self.assertFalse(any("biblioteca-boletines" in e.url for e in report.enlaces), "0 verificaciones del enlace quitado")


if __name__ == "__main__":
    unittest.main()
