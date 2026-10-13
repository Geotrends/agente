"""Informe de corrida (T013, contracts/run-report.md)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scraper.run_report import Enlace, ErrorEnlace, RunReport


def enlace(url: str = "https://gmas2.envigado.gov.co/gmas/x", **extra) -> Enlace:
    datos = dict(url=url, fuente="gmas2_envigado", fecha_hora="2026-10-11T02:00:00-05:00",
                 rol="procedimiento", resultado="nuevo", estado_detectado="vigente",
                 hash_contenido="a" * 64, archivo="gmas2_envigado/x.md")
    datos.update(extra)
    return Enlace(**datos)


class RunReportTests(unittest.TestCase):
    def test_escritura_atomica_y_forma(self) -> None:
        report = RunReport(fuentes=["gmas2_envigado"], programada=False)
        report.add(enlace())
        with tempfile.TemporaryDirectory() as tmp:
            destino = report.write(Path(tmp) / "runs")
            self.assertEqual(destino.name, f"{report.run_id}.json")
            self.assertFalse(list(Path(tmp, "runs").glob("*.tmp")), "no debe quedar el temporal")
            datos = json.loads(destino.read_text(encoding="utf-8"))
        self.assertEqual(datos["schema_version"], 1)
        self.assertFalse(datos["programada"])
        self.assertTrue(datos["completa"])
        self.assertEqual(datos["enlaces"][0]["rol"], "procedimiento")
        self.assertIsNone(datos["enlaces"][0]["error"])

    def test_error_nunca_deja_archivo(self) -> None:
        e = enlace(resultado="error", error=ErrorEnlace("http", "Service Unavailable", 503))
        self.assertIsNone(e.archivo)
        self.assertIsNone(e.hash_contenido)

    def test_valida_valores_del_contrato(self) -> None:
        with self.assertRaises(ValueError):
            enlace(rol="otro")
        with self.assertRaises(ValueError):
            enlace(resultado="error")  # error sin su detalle
        with self.assertRaises(ValueError):
            ErrorEnlace("desconocido")

    def test_no_alcanzado_no_pisa_una_visita_exitosa(self) -> None:
        report = RunReport(fuentes=["gmas2_envigado"])
        report.add(enlace())
        report.add(enlace(resultado="error", error=ErrorEnlace("inaccesible", "no alcanzado")))
        self.assertEqual(report.enlaces[0].resultado, "nuevo")
        self.assertEqual(len(report.enlaces), 1)

    def test_detalle_de_error_sin_saltos_ni_trazas_largas(self) -> None:
        e = ErrorEnlace("inaccesible", "linea 1\n  linea 2\t" + "x" * 1000)
        self.assertNotIn("\n", e.detalle)
        self.assertLessEqual(len(e.detalle), 300)


if __name__ == "__main__":
    unittest.main()
