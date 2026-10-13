"""Huella estable de una página (T041; RF-C3-IV-06, SC-013)."""

from __future__ import annotations

import unittest

from scraper.html_parser import parse_html

PAGINA = """
<html><body>
  <main>
    <h1>Calidad del aire</h1>
    <div class="loading">Cargando...</div>
    <p>Envigado cuenta con una estación propia para medir el material particulado PM2.5.</p>
    <p>Conoce en tiempo real las variables de calidad del aire.</p>
    {extra}
  </main>
  <footer>Actualizado el {fecha}</footer>
</body></html>
"""


def huella(extra: str = "", fecha: str = "1 de octubre") -> str:
    return parse_html(PAGINA.format(extra=extra, fecha=fecha), "https://ambientometroenvigado.com/calidad-del-aire/").content_hash


class HuellaTests(unittest.TestCase):
    def test_ruido_dinamico_no_cambia_la_huella(self) -> None:
        self.assertEqual(huella(fecha="1 de octubre"), huella(fecha="8 de octubre"))
        self.assertEqual(huella(), huella(extra='<div class="loading">Cargando...</div>'))

    def test_un_cambio_de_contenido_cambia_la_huella(self) -> None:
        self.assertNotEqual(huella(), huella(extra="<p>Nueva estación en el sector de Zúñiga.</p>"))


if __name__ == "__main__":
    unittest.main()
