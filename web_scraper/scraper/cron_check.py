"""Valida SCRAPER_CRON antes de programar el scraper (RF-C3-IV-02; research R5).

RF-C3-IV-02 exige verificar cada enlace como máximo cada 7 días. Una
expresión con día del mes o mes fijos (por ejemplo `0 2 1 * *`) deja huecos
de más de una semana, así que solo se aceptan expresiones de cinco campos con
`*` en día del mes y en mes. El día de la semana y la hora sí se eligen.

Uso: python -m scraper.cron_check "0 2 * * 0"   (sale con 1 y explica si no vale)
"""

from __future__ import annotations

import re
import sys

CAMPO = re.compile(r"^(\*|\d+)([-,/](\*|\d+))*$")


def validar_cron(expresion: str) -> str | None:
    """Devuelve None si vale, o el motivo del rechazo."""
    campos = expresion.split()
    if len(campos) != 5:
        return f"se esperaban 5 campos (minuto hora día-del-mes mes día-de-la-semana) y hay {len(campos)}"
    for nombre, valor in zip(("minuto", "hora", "día del mes", "mes", "día de la semana"), campos):
        if not CAMPO.match(valor):
            return f"el campo {nombre} no es válido: {valor!r}"
    if campos[2] != "*" or campos[3] != "*":
        return (
            "el día del mes y el mes deben ser '*': fijarlos deja más de 7 días entre "
            "verificaciones (RF-C3-IV-02); usa el día de la semana"
        )
    return None


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Uso: python -m scraper.cron_check '<expresión cron>'", file=sys.stderr)
        return 2
    motivo = validar_cron(argv[1])
    if motivo:
        print(f"SCRAPER_CRON inválido ({argv[1]!r}): {motivo}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
