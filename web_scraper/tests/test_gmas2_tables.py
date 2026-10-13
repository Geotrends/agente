"""Tablas del visor de GMAS2 en Markdown (T040; RF-C3-IV-09, research R8)."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from scraper.html_parser import parse_html
from scraper.sources import SOURCES

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "gmas2"
BASE = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento="


def markdown_de(nombre: str, doc_id: str) -> str:
    html = (FIXTURES / f"{nombre}.html").read_text(encoding="utf-8")
    return parse_html(html, BASE + doc_id, SOURCES["gmas2_envigado"].content_selectors).markdown


def filas_de_tabla(md: str, encabezado: str) -> list[list[str]]:
    """Filas (celdas) de la primera tabla Markdown cuyo encabezado contiene `encabezado`."""
    lineas = md.splitlines()
    for i, linea in enumerate(lineas):
        if linea.startswith("|") and encabezado in linea and i + 1 < len(lineas) and re.match(r"^\|\s*-{3}", lineas[i + 1]):
            filas = []
            for fila in lineas[i + 2:]:
                if not fila.startswith("|"):
                    break
                filas.append([c.strip() for c in fila.strip().strip("|").split("|")])
            return filas
    return []


class TablasGmas2Tests(unittest.TestCase):
    def test_flujo_de_actividades_de_gt_p_004(self) -> None:
        md = markdown_de("GT-P-004", "0000010207")
        filas = filas_de_tabla(md, "DESCRIPCI")
        self.assertEqual(len(filas), 5, f"se esperaban 5 actividades:\n{md[:3000]}")
        self.assertEqual([f[0] for f in filas], ["1", "2", "3", "4", "5"])
        self.assertIn("Profesionales Universitarios, Técnico Operativo", filas[1][2])
        self.assertEqual(filas[1][3], "20 días")
        self.assertIn("GT-F-011", filas[0][1])

    def test_rejillas_jqgrid_como_tablas_limpias(self) -> None:
        md = markdown_de("GT-P-004", "0000010207")
        registros = filas_de_tabla(md, "Registros")
        self.assertEqual(len(registros), 3, "MG-F-051, GT-F-011 y GT-F-012")
        self.assertTrue(any("GT-F-011" in " ".join(f) for f in registros))

    def test_sin_ruido_de_interfaz_ni_columnas_tecnicas(self) -> None:
        for nombre, doc_id in (("GT-P-004", "0000010207"), ("GT-P-021", "0000010445")):
            md = markdown_de(nombre, doc_id)
            for ruido in ("Cargando", "Vista Completa", "Acordeón", "Pestañas", "tipoRegistro", "Acciones"):
                self.assertNotIn(ruido, md, f"{nombre}: queda '{ruido}'")
            for linea in md.splitlines():
                if linea.startswith("|") and not re.match(r"^\|(\s*-{3,}\s*\|)+\s*$", linea):
                    self.assertNotIn("| --- |", linea, f"{nombre}: separador dentro de una celda: {linea[:120]}")

    def test_gt_p_021_conserva_sus_actividades(self) -> None:
        filas = filas_de_tabla(markdown_de("GT-P-021", "0000010445"), "DESCRIPCI")
        self.assertGreaterEqual(len(filas), 3)
        self.assertTrue(all(len(f) == len(filas[0]) for f in filas), "todas las filas con el mismo número de columnas")


if __name__ == "__main__":
    unittest.main()
