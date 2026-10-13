"""Un documento derogado se reporta y no se guarda (T059; RF-C3-IV-03, R10)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from gmas2_utils import crawler_gmas2, enlace, fixture, guardar


class DerogadoTests(unittest.TestCase):
    def test_un_derogado_queda_en_el_informe_sin_archivo_ni_hijos(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            crawler = crawler_gmas2(directorio)
            url, hijos = guardar(crawler, "0000000475", fixture("derogado"), profundidad=1)
            self.assertEqual(hijos, [], "de un derogado no se siguen enlaces")
            e = enlace(crawler, url)
            self.assertEqual(e.estado_detectado, "derogado")
            self.assertIsNone(e.archivo)
            self.assertIsNone(e.error)
            self.assertEqual(list(Path(directorio).rglob("*.md")), [], "no se guarda su Markdown")

    def test_un_procedimiento_derogado_tampoco_se_descarga(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            crawler = crawler_gmas2(directorio)
            url, hijos = guardar(crawler, "0000002961", fixture("MG-P-003"), profundidad=1)
            self.assertEqual(hijos, [])
            self.assertEqual(enlace(crawler, url).estado_detectado, "derogado")
            self.assertEqual(crawler.stats["documents_downloaded"], 0)

    def test_un_vigente_si_se_guarda(self) -> None:
        with tempfile.TemporaryDirectory() as directorio:
            crawler = crawler_gmas2(directorio)
            url, hijos = guardar(crawler, "0000010207", fixture("GT-P-004"))
            self.assertTrue(hijos)
            e = enlace(crawler, url)
            self.assertEqual(e.estado_detectado, "vigente")
            self.assertTrue(e.archivo)


if __name__ == "__main__":
    unittest.main()
