"""Captura HTML real para las fixtures de pruebas (T008, research R8/R10/R11).

Las pruebas de normalización de tablas, metadatos GMAS2, derogados y alcance
se escriben contra HTML real congelado, no contra HTML imaginado: así una
suposición equivocada sobre la estructura de jqGrid falla en la prueba y no en
producción.

Uso (desde web_scraper/):
    .venv/bin/python -m scripts.capture_fixtures

Escribe:
    tests/fixtures/gmas2/<codigo>.html      página renderizada completa
    tests/fixtures/observatorio/<host>.html
    tests/fixtures/README.md                host final tras redirecciones y si
                                            la página necesita JS
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
GMAS2 = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento={}"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

# Documentos fijos: los procedimientos de la entrega que usan las pruebas,
# un formato, un MG-P citado y una norma vinculada (ver research R10).
GMAS2_DOCS = {
    "GT-P-004": "0000010207",
    "GT-P-021": "0000010445",
    "GT-P-029": "0000004622",
    "GT-F-011": "0000013830",
    "MG-P-003": "0000002961",
    "GT-N-218": "0000001203",
}
OBSERVATORIO = (
    "https://observatorioenvigado.geotrends.co/observatorio",
    "https://ambientometroenvigado.com/",
)


@dataclass
class Captura:
    nombre: str
    url_pedida: str
    url_final: str
    necesita_js: bool
    nota: str = ""


def estado_de(html: str) -> str:
    tag = BeautifulSoup(html, "lxml").select_one(".estado")
    texto = tag.get_text(" ", strip=True) if tag else ""
    return re.sub(r"^[^:]*:\s*", "", texto).strip()


def ids_relacionados(html: str) -> list[str]:
    """IDs de GMAS2 enlazados desde el documento (relaciones y rejillas)."""
    return sorted(set(re.findall(r"VisualizacionDocumento\.public\?documento=(\d{10})", html)))


def texto_crudo(url: str) -> int:
    try:
        response = requests.get(url, timeout=30, headers={"User-Agent": UA})
        soup = BeautifulSoup(response.text, "lxml")
        for node in soup(["script", "style", "noscript"]):
            node.decompose()
        return len(soup.get_text(" ", strip=True))
    except requests.RequestException:
        return 0


def main() -> int:
    (FIXTURES / "gmas2").mkdir(parents=True, exist_ok=True)
    (FIXTURES / "observatorio").mkdir(parents=True, exist_ok=True)
    capturas: list[Captura] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(user_agent=UA)

        def render(url: str, idle: bool = True) -> str:
            # Un visor de mapas nunca queda con la red inactiva (pide teselas
            # sin parar): ahí basta con el evento load y unos segundos de JS.
            if idle:
                page.goto(url, wait_until="networkidle", timeout=60_000)
            else:
                page.goto(url, wait_until="load", timeout=60_000)
                page.wait_for_timeout(8_000)
            return page.content()

        relacionados: set[str] = set()
        for codigo, doc_id in GMAS2_DOCS.items():
            url = GMAS2.format(doc_id)
            html = render(url)
            page_url = page.url
            (FIXTURES / "gmas2" / f"{codigo}.html").write_text(html, encoding="utf-8")
            capturas.append(Captura(codigo, url, page.url, True, f"estado: {estado_de(html) or '¿?'}"))
            if codigo.startswith("GT-P"):
                relacionados.update(ids_relacionados(html))

        # Un documento derogado real: el primero, entre los relacionados con los
        # GT-P, cuyo estado no sea "Vigente". Se necesita para RF-C3-IV-03.
        derogado = None
        for doc_id in sorted(relacionados - set(GMAS2_DOCS.values())):
            html = render(GMAS2.format(doc_id))
            estado = estado_de(html)
            if estado and estado.casefold() != "vigente":
                derogado = (doc_id, html, estado)
                break
        if derogado:
            doc_id, html, estado = derogado
            (FIXTURES / "gmas2" / "derogado.html").write_text(html, encoding="utf-8")
            capturas.append(Captura("derogado", GMAS2.format(doc_id), page.url, True, f"estado: {estado}"))
        else:
            print("Aviso: no se encontró ningún documento derogado entre los relacionados.", file=sys.stderr)

        for url in OBSERVATORIO:
            html = render(url, idle=False)
            host = re.sub(r"^www\.", "", requests.utils.urlparse(page.url).hostname or "sin-host")
            (FIXTURES / "observatorio" / f"{host}.html").write_text(html, encoding="utf-8")
            renderizado = len(BeautifulSoup(html, "lxml").get_text(" ", strip=True))
            crudo = texto_crudo(url)
            capturas.append(Captura(host, url, page.url, crudo < renderizado * 0.5,
                                    f"texto crudo {crudo} vs renderizado {renderizado} caracteres"))
        browser.close()

    lineas = [
        "# Fixtures HTML reales",
        "",
        "Generadas con `python -m scripts.capture_fixtures`. No editar a mano: si la",
        "fuente cambia, se vuelven a capturar y las pruebas dicen qué se rompió.",
        "",
        "| Fixture | URL pedida | Host/URL final | ¿Necesita JS? | Nota |",
        "|---|---|---|---|---|",
    ]
    for c in capturas:
        lineas.append(f"| {c.nombre} | {c.url_pedida} | {c.url_final} | {'sí' if c.necesita_js else 'no'} | {c.nota} |")
    (FIXTURES / "README.md").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    print("\n".join(lineas))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
