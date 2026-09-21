#!/usr/bin/env bash
# Corre el crawler contra las 4 fuentes registradas en scraper/sources.py.
#
# Uso:
#   ./run_all_sources.sh [OUTPUT_DIR] [argumentos extra para main.py...]
#
# Ejemplos:
#   ./run_all_sources.sh                                  # sale a ./salida
#   ./run_all_sources.sh /datos/envigado
#   ./run_all_sources.sh /datos/envigado --dry-run
#   ./run_all_sources.sh /datos/envigado --max-pages 50 --delay 1.0
#
# Variables de entorno opcionales:
#   SOURCES  - lista de fuentes separadas por espacio (default: las 4 fuentes)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUTPUT_DIR="${1:-./salida}"
if [ "$#" -gt 0 ]; then
    shift
fi

SOURCES="${SOURCES:-ambientometro concejo_envigado minambiente minagricultura}"

if [ -f ".venv/bin/activate" ]; then
    # shellcheck disable=SC1091
    source ".venv/bin/activate"1
elif [ -z "${VIRTUAL_ENV:-}" ]; then
    echo "Aviso: no se encontro .venv/ ni hay un entorno virtual activo." >&2
    echo "Cree uno con: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt" >&2
fi

# shellcheck disable=SC2086
exec python3 main.py --output "$OUTPUT_DIR" --sources $SOURCES "$@"
