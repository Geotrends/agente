"""Detección de errores sin pérdida de lo validado (T060; RF-C3-IV-04)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import requests
from bs4 import BeautifulSoup

from gmas2_utils import BASE, crawler_gmas2, enlace, fixture, guardar
from scraper.crawler import CrawlItem


def sin(selector: str, html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for nodo in soup.select(selector):
        nodo.decompose()
    return str(soup)


class EstructuraTests(unittest.TestCase):
    def _guardada(self, directorio: str, crawler) -> tuple[str, Path, str]:
        url, _ = guardar(crawler, "0000010207", fixture("GT-P-004"))
        ruta = Path(directorio) / enlace(crawler, url).archivo
        return url, ruta, ruta.read_text(encoding="utf-8")

    def test_sin_estado_es_estructura_modificada_y_no_toca_el_archivo(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            crawler = crawler_gmas2(directorio)
            url, ruta, antes = self._guardada(directorio, crawler)
            crawler.metadata.known_page_urls[url] = enlace(crawler, url).archivo
            crawler.report.enlaces.clear(); crawler.report._urls.clear()
            guardar(crawler, "0000010207", sin(".estado", fixture("GT-P-004")))
            e = enlace(crawler, url)
            self.assertEqual(e.resultado, "error")
            self.assertEqual(e.error.tipo, "estructura_modificada")
            self.assertIsNone(e.archivo)
            self.assertEqual(ruta.read_text(encoding="utf-8"), antes)

    def test_sin_codigo_es_estructura_modificada(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            crawler = crawler_gmas2(directorio)
            url, _ = guardar(crawler, "0000010207", sin(".resalt", fixture("GT-P-004")))
            self.assertEqual(enlace(crawler, url).error.tipo, "estructura_modificada")
            self.assertEqual(list(Path(directorio).rglob("*.md")), [])

    def test_contenido_por_debajo_del_umbral_no_sobrescribe(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            crawler = crawler_gmas2(directorio, umbral=0.3)
            url, ruta, antes = self._guardada(directorio, crawler)
            crawler.metadata.known_page_urls[url] = enlace(crawler, url).archivo
            crawler.report.enlaces.clear(); crawler.report._urls.clear()
            # Se vacía el cuerpo del documento: queda el encabezado y el estado.
            reducido = sin("#visualization", fixture("GT-P-004"))
            guardar(crawler, "0000010207", reducido)
            e = enlace(crawler, url)
            self.assertEqual(e.error.tipo, "estructura_modificada")
            self.assertIn("cayó", e.error.detalle)
            self.assertEqual(ruta.read_text(encoding="utf-8"), antes)

    def test_http_503_se_reporta_con_su_codigo(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            crawler = crawler_gmas2(directorio)
            respuesta = SimpleNamespace(status_code=503)
            with mock.patch.object(crawler, "_fetch", side_effect=requests.HTTPError("503", response=respuesta)):
                crawler._visit(CrawlItem(BASE + "0000010207", 0, ""))
            e = enlace(crawler, BASE + "0000010207")
            self.assertEqual((e.resultado, e.error.tipo, e.error.codigo_http), ("error", "http", 503))

    def test_url_conocida_no_visitada_queda_como_no_alcanzada(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            crawler = crawler_gmas2(directorio)
            crawler.metadata.urls_previas_por_fuente = {"gmas2_envigado": {BASE + "0000099999"}}
            crawler._reportar_no_alcanzados()
            e = enlace(crawler, BASE + "0000099999")
            self.assertEqual(e.resultado, "error")
            self.assertEqual(e.error.detalle, "no alcanzado")


if __name__ == "__main__":
    unittest.main()
