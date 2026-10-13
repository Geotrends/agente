#!/usr/bin/env python3
"""Genera el oráculo del tokenizador (T059). SOLO se usa fuera de línea: el backend en
línea es TypeScript y nunca ejecuta Python ni llama a CountTokens.

    python3 -m venv /ruta/venv && /ruta/venv/bin/pip install tiktoken
    /ruta/venv/bin/python backend/scripts/tokenizer-oracle.py > backend/test/fixtures/di/tokenizer-oracle.json

Para cada texto de prueba guarda los IDs de `tiktoken.encode_ordinary` con la codificación
oficial `o200k_harmony` (los tokens especiales se tratan como texto, sin añadir marcadores).
"""
import json
import sys

import tiktoken

ENC = "o200k_harmony"

TEXTOS = [
    "Hola, ¿cómo estás? Quiero registrar a mi mascota en el RUM.",
    "Señores de la Secretaría de Medio Ambiente: solicito información sobre la poda de árboles en el espacio público.",
    "Ñandú, pingüino, canción, acción, México, Perú — niño/niña; ¡atención!",
    "日本語のテキストと emoji 🐶🌳 y símbolos ©®™ — «comillas» “dobles”",
    "# Título\n\n- Elemento 1\n- Elemento 2\n\n| Documento | Plazo |\n|---|---|\n| GT-P-020 | 15 días |\n\n**negrita** _cursiva_ `código`",
    "1. Presente la solicitud.\n2. Adjunte el formato GT-F-058.\n3. Espere la visita técnica.",
    "Consulte [PQRSD](https://www.envigado.gov.co/tema/pqrds-consulta) o https://www.envigado.gov.co/contactenos/?a=1&b=2#fin",
    "Escriba a ciudadano@envigado.gov.co o a juan.perez+geobot@correo.example.org",
    "Mi cédula es [CÉDULA], mi celular [TELÉFONO] y mi correo [CORREO]; vivo en [DIRECCIÓN].",
    "Ley 1581 de 2012, Decreto 1074 de 2015, Acuerdo 034 de 2019, Resolución 40103; 12/03/2026 y 2026-10-08.",
    "<|endoftext|> <|start|> <|end|> <|message|> <|channel|> <|return|> <|call|> <|constrain|> <|endofprompt|>",
    "<|start|>assistant<|channel|>final<|message|>Hola<|end|>",
    "Respuesta abreviada por su extensión; consulte el documento para el detalle completo",
    "   espacios   múltiples\t\ttabulaciones\r\ny saltos de línea\n\n\n",
    "",
    "a",
    "x" * 500,
    "palabra " * 300,
    "Este procedimiento aplica a las direcciones de Ecosistemas, Bienestar Animal y Gestión Ambiental del Municipio de Envigado. " * 20,
]


def main() -> None:
    enc = tiktoken.get_encoding(ENC)
    casos = [{"texto": t, "ids": enc.encode_ordinary(t)} for t in TEXTOS]
    json.dump(
        {"encoding": ENC, "tiktoken": tiktoken.__version__, "n_vocab": enc.n_vocab, "casos": casos},
        sys.stdout, ensure_ascii=False, indent=1,
    )


if __name__ == "__main__":
    main()
