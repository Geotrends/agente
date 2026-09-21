"""
eval_bot.py — Bot de evaluación automatizada para el chat RAG local.

Recorre un CSV de preguntas (pregunta, complejidad, fuente), las envía una por
una a la app de chat (http://localhost:3002 por defecto) para cada
proveedor+modelo indicado en --providers, espera la respuesta del asistente y
guarda todo en un CSV de resultados compatible con el framework de evaluación.

SmartAgentPanel ya no tiene un <select id="provider"> separado: el selector
único <select id="model"> combina proveedor y modelo en un solo <option>
(value "auto" para enrutamiento automático, o "proveedor::modelo" agrupado
por <optgroup> por proveedor — deshabilitado cuando ese proveedor no tiene
API key configurada). Este script lee esas opciones directamente del DOM.

Historial: se recarga la página antes de CADA pregunta, así que cada
evaluación parte de cero (sin contaminar el score con turnos previos).

Requisitos:
    pip install playwright
    playwright install chromium

Uso típico:
    python eval_bot.py \
        --input preguntas.csv \
        --output resultados.csv \
        --url http://localhost:3002 \
        --providers gemini,groq,deepseek \
        --prompt-version v1

--providers acepta, separados por coma:
    - "auto"                        -> prueba el enrutamiento automático.
    - un id de proveedor (ej. "gemini") -> corre TODOS los modelos de ese
      proveedor (todo su <optgroup>).
    - "proveedor::modelo" exacto (ej. "gemini::gemini-flash-latest") -> corre
      solo ese modelo puntual.

Si no pasas --providers, el script detecta automáticamente todas las
opciones del <select id="model"> (incluyendo "auto") cuyo proveedor esté
configurado, y corre el set completo de preguntas para cada una.

CSV de entrada esperado (columnas, con o sin encabezado exacto):
    pregunta,complejidad,fuente

CSV de salida (una fila por pregunta x proveedor+modelo):
    prompt_version,modelo,modelo_llm,pregunta,complejidad_pregunta,respuesta,
    fuente,tiempo_respuesta_seg,caracteres,verbosidad,cita_correcta,
    fidelidad_respuesta,idioma_correcto

`modelo` es el id de proveedor ("gemini", "groq"... o "auto"); `modelo_llm`
es el modelo puntual usado dentro de ese proveedor ("auto" cuando se probó
enrutamiento automático). Las columnas verbosidad/cita_correcta/
fidelidad_respuesta/idioma_correcto quedan vacías a propósito — esas las
calificas tú (o un revisor humano) después, mirando la columna `respuesta`.
"""

import argparse
import csv
import sys
import time
import unicodedata
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

# --- Selectores basados en el HTML inspeccionado de tu app ---
SELECTOR_INPUT = 'input.input[aria-label="Pregunta"]'
SELECTOR_SUBMIT = 'button.button.icon-button[type="submit"]'
SELECTOR_MESSAGES = ".messages.smart-messages"
SELECTOR_ASSISTANT_MSG = ".message.assistant .chat-markdown"
SELECTOR_MODEL_SELECT = "#model"
SELECTOR_LATENCY_HINT = ".latency-hint strong"

AUTO_TARGET_VALUE = "auto"

OUTPUT_FIELDS = [
    "prompt_version",
    "modelo",
    "modelo_llm",
    "pregunta",
    "complejidad_pregunta",
    "respuesta",
    "fuente",
    "tiempo_respuesta_seg",
    "caracteres",
    "verbosidad",
    "cita_correcta",
    "fidelidad_respuesta",
    "idioma_correcto",
]


def read_questions(path: str):
    """Lee el CSV de preguntas. Acepta encabezados pregunta/complejidad/fuente
    en cualquier orden, o sin encabezado (asume ese orden)."""
    questions = []
    # utf-8-sig elimina el BOM antes de que csv interprete las comillas.
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        rows = [row for row in reader if any(cell.strip() for cell in row)]

    start_idx = 0
    header = [h.strip().lower() for h in rows[0]] if rows else []
    # Los nombres conocidos son más fiables que la heurística de Sniffer.
    if {"pregunta", "complejidad", "fuente"}.issubset(set(header)):
        idx = {name: header.index(name) for name in ("pregunta", "complejidad", "fuente")}
        start_idx = 1
    else:
        idx = {"pregunta": 0, "complejidad": 1, "fuente": 2}
        start_idx = 0

    for row in rows[start_idx:]:
        if not row or not row[idx["pregunta"]].strip():
            continue
        questions.append(
            {
                "pregunta": row[idx["pregunta"]].strip(),
                "complejidad": row[idx["complejidad"]].strip(),
                "fuente": row[idx["fuente"]].strip(),
            }
        )
    return questions


def get_model_options(page):
    """Lee las opciones de <select id="model">: "auto" mas cada modelo de
    cada proveedor (agrupados por <optgroup>, uno por proveedor).

    Devuelve una lista de dicts {value, label, provider, model, configured}.
    `configured` es False cuando el <optgroup> del proveedor esta
    deshabilitado (proveedor sin API key), tal como lo pinta SmartAgentPanel.
    """
    return page.eval_on_selector_all(
        f"{SELECTOR_MODEL_SELECT} option",
        """els => els.map(el => {
            const optgroup = el.closest('optgroup');
            if (el.value === 'auto') {
                return { value: el.value, label: el.textContent.trim(), provider: '', model: '', configured: true };
            }
            const sep = el.value.indexOf('::');
            return {
                value: el.value,
                label: el.textContent.trim(),
                provider: sep >= 0 ? el.value.slice(0, sep) : '',
                model: sep >= 0 ? decodeURIComponent(el.value.slice(sep + 2)) : '',
                configured: optgroup ? !optgroup.disabled : true,
            };
        })""",
    )


def select_model(page, value):
    page.select_option(SELECTOR_MODEL_SELECT, value)
    # Dale un tick al framework para que registre el cambio (React onChange).
    page.wait_for_timeout(150)


def resolve_targets(args, available):
    """Aplica --providers sobre las opciones detectadas en #model.

    Sin --providers: todas las opciones cuyo proveedor este configurado
    (equivalente a lo que un usuario real puede elegir en el dropdown).
    Con --providers: cada valor puede ser "auto", un id de proveedor (corre
    todos sus modelos) o un "proveedor::modelo" exacto.
    """
    if not args.providers:
        return [o for o in available if o["configured"]]

    by_value = {o["value"]: o for o in available}
    providers_available = {o["provider"] for o in available if o["provider"]}
    targets = []
    for raw in args.providers.split(","):
        value = raw.strip()
        if not value:
            continue
        if value in by_value:
            targets.append(by_value[value])
        elif value in providers_available:
            targets.extend(o for o in available if o["provider"] == value)
        else:
            print(
                f"Aviso: '{value}' no coincide con ningun proveedor/modelo de #model. "
                f"Proveedores detectados: {sorted(providers_available)}. "
                "Usa 'auto', un id de proveedor, o 'proveedor::modelo' exacto.",
                file=sys.stderr,
            )
    return targets


def ask_question(page, question_text, timeout_ms):
    """Envía una pregunta y espera a que aparezca una respuesta nueva del
    asistente. Devuelve (texto_respuesta, tiempo_segundos)."""
    prev_count = page.locator(SELECTOR_ASSISTANT_MSG).count()

    page.fill(SELECTOR_INPUT, question_text)
    start = time.monotonic()
    page.click(SELECTOR_SUBMIT)

    try:
        page.wait_for_function(
            f"""(prevCount) => document.querySelectorAll('{SELECTOR_ASSISTANT_MSG}').length > prevCount""",
            arg=prev_count,
            timeout=timeout_ms,
        )
    except PWTimeout:
        elapsed = time.monotonic() - start
        return f"[TIMEOUT tras {timeout_ms/1000:.0f}s esperando respuesta]", elapsed

    elapsed = time.monotonic() - start
    last_msg = page.locator(SELECTOR_ASSISTANT_MSG).last
    respuesta = last_msg.inner_text().strip()
    return respuesta, elapsed


def ask_with_retries(page, url, target, question_text, timeout_ms):
    """Reintenta los límites de uso con pausas de 15, 30 y luego 60 s.

    `target` es un dict como los que devuelve get_model_options (value,
    label, provider, model, configured). No hay máximo de reintentos; el
    tiempo devuelto es el del último intento.
    """
    delay = 15
    while True:
        # Historial limpio también cuando repetimos la misma pregunta.
        page.goto(url, wait_until="networkidle")
        select_model(page, target["value"])
        respuesta, elapsed = ask_question(page, question_text, timeout_ms)
        normalized = unicodedata.normalize("NFKD", respuesta.casefold())
        normalized = "".join(c for c in normalized if not unicodedata.combining(c))
        normalized = " ".join(normalized.split())
        if "intenta mas tarde" not in normalized:
            return respuesta, elapsed

        print(
            f"{target['label']} | límite de uso: esperando {delay}s antes de repetir la misma pregunta...",
            flush=True,
        )
        time.sleep(delay)
        delay = min(delay * 2, 60)


def run_eval(args):
    questions = read_questions(args.input)
    if not questions:
        print(f"No se encontraron preguntas en {args.input}", file=sys.stderr)
        sys.exit(1)
    print(f"{len(questions)} preguntas cargadas desde {args.input}")

    out_path = Path(args.output)
    write_header = not out_path.exists()
    out_file = open(out_path, "a", newline="", encoding="utf-8")
    writer = csv.DictWriter(out_file, fieldnames=OUTPUT_FIELDS)
    if write_header:
        writer.writeheader()
        out_file.flush()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        page = browser.new_page()
        page.goto(args.url, wait_until="networkidle")

        # Resuelve qué proveedor+modelo correr, leyendo el <select id="model">
        # real (value "auto", o "proveedor::modelo" agrupado por <optgroup>).
        available = get_model_options(page)
        targets = resolve_targets(args, available)
        if not targets:
            print(
                "No hay proveedores/modelos para evaluar (revisa --providers, o si algun "
                "proveedor tiene API key configurada).",
                file=sys.stderr,
            )
            sys.exit(1)
        if not args.providers:
            print(f"--providers no especificado; usando todas las opciones configuradas: "
                  f"{[t['label'] for t in targets]}")

        total = len(targets) * len(questions)
        done = 0

        for target in targets:
            label = target["label"]
            modelo = target["provider"] or AUTO_TARGET_VALUE
            modelo_llm = target["model"] or AUTO_TARGET_VALUE
            for q in questions:
                respuesta, elapsed = ask_with_retries(
                    page, args.url, target, q["pregunta"], args.timeout_ms
                )
                caracteres = len(respuesta)

                row = {
                    "prompt_version": args.prompt_version,
                    "modelo": modelo,
                    "modelo_llm": modelo_llm,
                    "pregunta": q["pregunta"],
                    "complejidad_pregunta": q["complejidad"],
                    "respuesta": respuesta,
                    "fuente": q["fuente"],
                    "tiempo_respuesta_seg": f"{elapsed:.2f}",
                    "caracteres": caracteres,
                    "verbosidad": "",
                    "cita_correcta": "",
                    "fidelidad_respuesta": "",
                    "idioma_correcto": "",
                }
                writer.writerow(row)
                out_file.flush()  # guarda incrementalmente: un crash no pierde progreso

                done += 1
                preview = respuesta[:60].replace("\n", " ")
                print(f"[{done}/{total}] {label} | {elapsed:.1f}s | {caracteres} chars | {preview}...")

        browser.close()

    out_file.close()
    print(f"\nListo. Resultados guardados en {out_path}")


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", required=True, help="CSV de preguntas (pregunta,complejidad,fuente)")
    p.add_argument("--output", required=True, help="CSV de salida (se crea o se le hace append)")
    p.add_argument("--url", default="http://localhost:3000", help="URL de la app de chat")
    p.add_argument(
        "--providers",
        default=None,
        help="Objetivos a evaluar, separados por coma: 'auto' (enrutamiento automatico), "
        "un id de proveedor (corre todos sus modelos, ej. 'gemini') o un 'proveedor::modelo' "
        "exacto (ej. 'gemini::gemini-flash-latest'). Si se omite, corre todas las opciones "
        "configuradas del <select id='model'> de la pagina.",
    )
    p.add_argument("--prompt-version", default="v1", help="Etiqueta de versión de prompt para esta corrida")
    p.add_argument("--timeout-ms", type=int, default=60_000, help="Timeout por pregunta en ms (default 60s)")
    p.add_argument("--headless", action="store_true", help="Corre el navegador sin ventana visible")
    return p.parse_args()


if __name__ == "__main__":
    run_eval(parse_args())
