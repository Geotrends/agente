"""El navegador del scraper no ingiere contenido de hosts no permitidos (SPEC008 NV-04, FR-013).

Sin Chromium: se simulan la pagina y las solicitudes de Playwright para ejercitar los filtros.
"""

from __future__ import annotations

import tempfile
import unittest
from types import SimpleNamespace

from gmas2_utils import BASE, crawler_gmas2, enlace
from scraper.crawler import CrawlItem
from scraper.utils import host_is_internal

URL = BASE + "0000000999"


class PaginaFalsa:
    """Imita lo minimo de `playwright.sync_api.Page`."""

    def __init__(self, destino: str, html: str = "<html><body><main><p>contenido</p></main></body></html>") -> None:
        self.destino, self.html, self.url = destino, html, "about:blank"
        self.rutas = []

    def route(self, patron, manejador):  # noqa: ANN001
        self.rutas.append((patron, manejador))

    def goto(self, url, **_):  # noqa: ANN001, ANN003
        self.url = self.destino  # el navegador termina donde diga la prueba (meta refresh, JS...)

    def wait_for_timeout(self, _):  # noqa: ANN001
        return None

    def content(self) -> str:
        return self.html


class Solicitud:
    def __init__(self, url: str, navegacion: bool, tipo: str = "script") -> None:
        self.url, self._nav, self.resource_type = url, navegacion, tipo

    def is_navigation_request(self) -> bool:
        return self._nav


class Ruta:
    def __init__(self, solicitud: Solicitud) -> None:
        self.request, self.resultado = solicitud, None

    def continue_(self) -> None:
        self.resultado = "continue"

    def abort(self) -> None:
        self.resultado = "abort"


def respuesta_falsa(url: str):
    return SimpleNamespace(
        url=url, status_code=200, headers={"Content-Type": "text/html; charset=utf-8"}, encoding="utf-8",
        apparent_encoding="utf-8", text="<html></html>", raise_for_status=lambda: None, close=lambda: None,
    )


class RenderHostTests(unittest.TestCase):
    def crawler(self, directorio: str):
        c = crawler_gmas2(directorio)
        c.config.render_js = True
        c._fetch = lambda url: respuesta_falsa(url)  # type: ignore[method-assign]
        return c

    def test_el_navegador_que_termina_en_otro_host_descarta_la_pagina_y_la_reporta(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            c = self.crawler(directorio)
            c._browser_page = PaginaFalsa("https://sitio-externo.example.org/phishing")
            hijos = c._visit(CrawlItem(URL, 0, ""))
            self.assertEqual(hijos, [])
            self.assertEqual(c.stats["pages_saved_as_markdown"], 0, "no se guarda nada")
            e = enlace(c, URL)
            self.assertEqual(e.error.tipo, "fuera_de_alcance")
            self.assertEqual(e.error.detalle, "host_no_permitido")
            self.assertIsNone(e.archivo)
            self.assertEqual(c._navegador_descartes, ["https://sitio-externo.example.org/phishing"])

    def test_el_navegador_que_termina_en_una_direccion_interna_tambien_se_descarta(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            c = self.crawler(directorio)
            c._browser_page = PaginaFalsa("http://169.254.169.254/latest/meta-data/")
            c._visit(CrawlItem(URL, 0, ""))
            self.assertEqual(enlace(c, URL).error.tipo, "fuera_de_alcance")

    def test_una_fuente_legitima_se_renderiza_igual(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            c = self.crawler(directorio)
            c._browser_page = PaginaFalsa(URL)
            html = c._render_html(URL)
            self.assertIn("contenido", html)
            self.assertEqual(c._navegador_descartes, [])

    def test_las_navegaciones_a_hosts_ajenos_y_la_red_interna_se_abortan(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            c = self.crawler(directorio)

            def veredicto(url: str, navegacion: bool, tipo: str = "script") -> str:
                ruta = Ruta(Solicitud(url, navegacion, tipo))
                c._filtrar_solicitud_navegador(ruta)
                return ruta.resultado

            self.assertEqual(veredicto(BASE + "1", True, "document"), "continue", "host permitido")
            self.assertEqual(veredicto("https://sitio-externo.example.org/", True, "document"), "abort", "navegacion ajena")
            self.assertEqual(veredicto("https://sitio-externo.example.org/f", False, "document"), "abort", "iframe ajeno")
            self.assertEqual(veredicto("http://127.0.0.1:8080/admin", False, "xhr"), "abort", "loopback")
            self.assertEqual(veredicto("http://10.0.0.5/x", False, "image"), "abort", "red privada")
            self.assertEqual(veredicto("http://169.254.169.254/latest", False, "fetch"), "abort", "metadatos de nube")
            self.assertEqual(veredicto("https://cdn.example.org/lib.js", False, "script"), "continue", "recurso publico de terceros")
            self.assertEqual(veredicto("data:image/png;base64,AAAA", False, "image"), "continue")

    def test_host_is_internal(self) -> None:
        for interno in ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.9", "169.254.169.254", "::1", "metadata.internal"]:
            self.assertTrue(host_is_internal(interno), interno)
        for publico in ["gmas2.envigado.gov.co", "8.8.8.8", "example.org"]:
            self.assertFalse(host_is_internal(publico), publico)


if __name__ == "__main__":
    unittest.main()
