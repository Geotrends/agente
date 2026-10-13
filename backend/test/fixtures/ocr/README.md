# Fixtures de OCR (T051; RF-C3-IV-07, RF-C3-IV-08)

Las genera `generar.py` con Playwright (Chromium) y pandoc:

```bash
web_scraper/.venv/bin/python -I backend/test/fixtures/ocr/generar.py
```

| Archivo | Qué es | Medida al generarla (Tesseract 5, `spa+eng`) |
|---|---|---|
| `escaneo-legible.pdf` | 1 página, solo una imagen de texto impreso a 300 dpi, sin capa de texto | 0 caracteres nativos; OCR: 47 palabras, confianza media 96,6 |
| `escaneo-ilegible.pdf` | 1 página, imagen a 150 dpi de letras sueltas giradas en cursiva y trazos encima, como un manuscrito borroso | 0 caracteres nativos; OCR: 48 palabras, confianza media 54,2 |
| `nativo-79.pdf` | PDF con texto nativo de exactamente 79 caracteres no blancos | debe pasar por OCR |
| `nativo-80.pdf` | El mismo texto más un carácter: 80 caracteres no blancos | nunca pasa por OCR |
| `nativo-ilegible.pdf` | PDF con 216 caracteres nativos, la capa de texto rota de los acuerdos de 2004 ("E EL L C CO ON NC CE EJ JO O") | no pasa por OCR; `calidad_nativa_baja` |
| `docx-escaneado.docx` | DOCX que solo contiene `imagen.png`, sin texto alternativo | 0 caracteres nativos; OCR de `word/media` |
| `imagen.png` | Dos líneas de texto impreso a 300 dpi | OCR: 17 palabras, confianza media 96,5 |

Las confianzas son la media de `conf` de las palabras con `conf >= 0` del TSV de Tesseract
(research R6). Pueden variar algunas décimas entre versiones de Tesseract. Las pruebas no
comparan valores exactos: solo comprueban que el escaneo legible supere 80 y el ilegible no.

El texto de los escaneos es ficticio y no contiene datos personales.
