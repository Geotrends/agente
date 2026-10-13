"""Genera las fixtures de OCR (T051; RF-C3-IV-07, IV-08). Ver README.md.

Uso, desde la raíz del repositorio:

    web_scraper/.venv/bin/python -I backend/test/fixtures/ocr/generar.py

Requiere Playwright (ya está en el venv del scraper) y pandoc para el DOCX.
Es determinista: el ruido del escaneo ilegible usa una semilla fija.
"""
from __future__ import annotations

import base64
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

DIR = Path(__file__).resolve().parent

TEXTO_LEGIBLE = [
    "SECRETARÍA DE MEDIO AMBIENTE Y DESARROLLO AGROPECUARIO",
    "Solicitud de visita técnica por tala o poda de árboles",
    "El ciudadano radica la solicitud en la Ventanilla Única",
    "con la dirección del predio y el número de árboles.",
    "La visita se programa en un plazo de quince días hábiles.",
]

# 79 y 80 caracteres no blancos exactos (sin ligaduras "fi"/"fl").
NATIVO_79 = "Resolucion de prueba numero uno para medir el umbral de OCR exacto " + "A" * 24
NATIVO_80 = NATIVO_79 + "B"

# Capa de texto rota como la de los acuerdos de 2004: cada carácter duplicado.
BASURA = (
    "E EL L C CO ON NC CE EJ JO O M MU UN NI IC CI IP PA AL L D DE E E EN NV VI IG GA AD DO O "
    "A AC CU UE ER RD DA A Q QU UE E L LA A A AD DM MI IN NI IS ST TR RA AC CI IO ON N "
) * 2

CSS_ESCANEO = (
    "html,body{margin:0;background:#fff}"
    "div{padding:60px 70px;font:34px/1.6 'Times New Roman',serif;color:#111}"
)


def _no_blancos(texto: str) -> int:
    return len("".join(texto.split()))


def _captura(page, html: str, ancho: int, alto: int, destino: Path) -> None:
    page.set_viewport_size({"width": ancho, "height": alto})
    page.set_content(html)
    page.screenshot(path=str(destino), full_page=False)


def _pdf_de_html(page, html: str, destino: Path, ancho_in: float, alto_in: float) -> None:
    page.set_content(html)
    page.pdf(path=str(destino), width=f"{ancho_in}in", height=f"{alto_in}in", print_background=True,
             margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})


def _pdf_de_imagen(page, imagen: Path, destino: Path, ancho_in: float, alto_in: float) -> None:
    datos = base64.b64encode(imagen.read_bytes()).decode()
    html = (f"<style>@page{{margin:0}}html,body{{margin:0}}img{{width:{ancho_in}in;height:{alto_in}in;display:block}}"
            f"</style><img src='data:image/png;base64,{datos}'>")
    _pdf_de_html(page, html, destino, ancho_in, alto_in)


RUIDO_JS = """
() => {
  // Simula un manuscrito borroso: letras sueltas giradas y trazos encima.
  const c = document.createElement('canvas'); c.width = 1275; c.height = 550;
  document.body.appendChild(c);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  let s = 20261007;  // semilla fija: el archivo es reproducible
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const letras = 'abcdefghijklmnopqrstuvwxyz';
  g.fillStyle = '#222';
  for (let y = 70; y < c.height; y += 80) {
    for (let x = 40; x < c.width - 40; x += 22 + r() * 18) {
      g.save(); g.translate(x, y + (r() - .5) * 20); g.rotate((r() - .5) * 1.4);
      g.font = `italic ${26 + r() * 20}px 'Brush Script MT', cursive`;
      g.fillText(letras[Math.floor(r() * letras.length)], 0, 0); g.restore();
    }
  }
  g.strokeStyle = '#333';
  for (let i = 0; i < 60; i++) {
    g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(r() * c.width, r() * c.height);
    g.quadraticCurveTo(r() * c.width, r() * c.height, r() * c.width, r() * c.height); g.stroke();
  }
}
"""


def main() -> None:
    assert _no_blancos(NATIVO_79) == 79 and _no_blancos(NATIVO_80) == 80
    with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
        navegador = p.chromium.launch()
        # 2550 px de ancho para 8,5 in: 300 dpi.
        page = navegador.new_page(device_scale_factor=2)
        lineas = "".join(f"<p style='margin:0'>{l}</p>" for l in TEXTO_LEGIBLE)
        html = f"<style>{CSS_ESCANEO}</style><div>{lineas}</div>"

        legible_png = Path(tmp) / "legible.png"
        _captura(page, html, 1275, 550, legible_png)
        _pdf_de_imagen(page, legible_png, DIR / "escaneo-legible.pdf", 8.5, 8.5 * 550 / 1275)

        ilegible_png = Path(tmp) / "ilegible.png"
        page = navegador.new_page(device_scale_factor=1)  # 150 dpi: un escaneo pobre y un archivo chico
        page.set_viewport_size({"width": 1275, "height": 550})
        page.set_content("<style>html,body{margin:0}</style>")
        page.evaluate(RUIDO_JS)
        page.screenshot(path=str(ilegible_png))
        _pdf_de_imagen(page, ilegible_png, DIR / "escaneo-ilegible.pdf", 8.5, 8.5 * 550 / 1275)

        # imagen.png: dos líneas, a 300 dpi; es también la imagen del DOCX.
        page_img = navegador.new_page(device_scale_factor=2)
        corto = "".join(f"<p style='margin:0'>{l}</p>" for l in TEXTO_LEGIBLE[:2])
        _captura(page_img, f"<style>{CSS_ESCANEO}</style><div>{corto}</div>", 1275, 260, DIR / "imagen.png")

        texto_css = "<style>body{font:14px Arial,sans-serif;margin:40px}</style>"
        _pdf_de_html(page, f"{texto_css}<p>{NATIVO_79}</p>", DIR / "nativo-79.pdf", 8.5, 3)
        _pdf_de_html(page, f"{texto_css}<p>{NATIVO_80}</p>", DIR / "nativo-80.pdf", 8.5, 3)
        _pdf_de_html(page, f"{texto_css}<p>{BASURA}</p>", DIR / "nativo-ilegible.pdf", 8.5, 4)
        navegador.close()

        # DOCX que solo contiene la imagen, sin texto alternativo.
        md = Path(tmp) / "docx.md"
        md.write_text(f"![]({DIR / 'imagen.png'})\n", encoding="utf-8")
        subprocess.run(["pandoc", str(md), "-o", str(DIR / "docx-escaneado.docx")], check=True)


if __name__ == "__main__":
    main()
