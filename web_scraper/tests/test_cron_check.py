"""SCRAPER_CRON solo admite expresiones con corridas al menos semanales (T064; RF-C3-IV-02)."""

from __future__ import annotations

import unittest

from scraper.cron_check import main, validar_cron


class CronCheckTests(unittest.TestCase):
    def test_acepta_las_semanales_y_diarias(self) -> None:
        for expresion in ("0 2 * * 0", "30 3 * * 1,4", "0 */6 * * *", "0 2 * * *"):
            self.assertIsNone(validar_cron(expresion), expresion)

    def test_rechaza_dia_del_mes_o_mes_fijos(self) -> None:
        for expresion in ("0 2 1 * *", "0 2 * 6 *", "0 2 */10 * 0", "0 2 15 3 *"):
            self.assertIn("7 días", validar_cron(expresion) or "", expresion)

    def test_rechaza_lo_mal_formado(self) -> None:
        for expresion in ("", "0 2 * *", "0 2 * * 0 0", "cada semana", "0 2 * * lunes"):
            self.assertIsNotNone(validar_cron(expresion), expresion)

    def test_codigos_de_salida(self) -> None:
        self.assertEqual(main(["cron_check", "0 2 * * 0"]), 0)
        self.assertEqual(main(["cron_check", "0 2 1 * *"]), 1)
        self.assertEqual(main(["cron_check"]), 2)


if __name__ == "__main__":
    unittest.main()
