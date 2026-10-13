"""Filtrado deterministico (sin IA) para el crawler multi-fuente.

Dos niveles, tal como los usa `scraper.crawler`:

- Nivel A, `should_crawl_url`: decide si una URL de pagina entra a la cola.
- Nivel B, `should_download_document`: decide si un adjunto se descarga.

Ambos devuelven `(decision, razon, score)` para que el modo `--dry-run` pueda
registrar una explicacion auditable sin descargar nada.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

from .utils import DOCUMENT_EXTENSIONS


# Extensiones que deben priorizarse fuertemente sobre csv/txt (seccion 7).
HIGH_PRIORITY_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx"}

# Pistas de que una URL es un indice/listado necesario para descubrir normativa,
# no un documento en si. Se usan para no bloquear la exploracion aunque su
# propio score textual sea bajo (seccion 5: "excepto paginas de indice").
INDEX_HINT_TERMS = (
    "normatividad", "normativa", "gaceta", "categoria_boletines", "categoria",
    "boletin", "decretos", "resoluciones", "leyes", "acuerdos", "circulares",
    "conpes", "page", "pagina",
)

BASE_POSITIVE_TERMS: dict[str, int] = {
    "decreto": 5, "resolucion": 5, "resolución": 5, "ley": 5,
    "normatividad": 4, "normativa": 4, "lineamiento": 4, "guia": 4, "guía": 4,
    "manual": 4, "politica": 3, "política": 3, "plan": 3, "protocolo": 3,
    "documento tecnico": 3, "documento técnico": 3, "acuerdo": 3, "circular": 3,
}
BASE_NEGATIVE_TERMS: dict[str, int] = {
    "noticia": -5, "prensa": -5, "evento": -5, "galeria": -5, "galería": -5,
    "video": -5, "convocatoria": -4, "instagram": -3, "facebook": -3,
    "twitter": -3, "youtube": -3, "vacante": -4, "hoja de vida": -4,
}

DOCUMENT_TYPE_PATTERNS: dict[str, str] = {
    "acuerdo": r"acuerdos?\b",
    "decreto": r"decretos?\b",
    "resolucion": r"resoluci[oó]n(?:es)?\b",
    "ley": r"\bley(?:es)?\b",
    "circular": r"circular(?:es)?\b",
    "guia": r"gu[ií]as?\b",
    "manual": r"manual(?:es)?\b",
    "politica": r"pol[ií]ticas?\b",
    "plan": r"plan(?:es)?\b",
    "protocolo": r"protocolos?\b",
}
_TYPE_NUMBER_RE = re.compile(
    r"(acuerdo|decreto|dec\.?|resoluci[oó]n|res\.?|ley|circular|cir(?:c)?\.?)\w*\s*"
    # Algunas entidades (p.ej. Concejo de Envigado) usan radicados largos
    # tipo "20260000540" en vez de un consecutivo corto ("008").
    r"(?:no\.?|n[uú]mero|nro\.?)?\s*0*(\d{1,12})\b",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"(?:19|20)\d{2}")


def _fold(text: str) -> str:
    """minusculas + sin tildes, para comparar de forma robusta y determinista."""
    normalized = unicodedata.normalize("NFKD", text or "")
    without_accents = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return without_accents.lower()


def _url_text(url: str) -> str:
    parts = urlsplit(url)
    return unquote(f"{parts.path} {parts.query}".replace("-", " ").replace("_", " "))


def relevance_score(
    *, url: str = "", title: str = "", anchor_text: str = "", filename: str = "",
    page_text: str = "", extra_positive: dict[str, int] | None = None,
    extra_negative: dict[str, int] | None = None,
) -> tuple[int, list[str]]:
    """Score simple y auditable: suma de pesos de terminos encontrados.

    Cada termino aporta su peso una sola vez (no por ocurrencia), para que el
    resultado sea estable y facil de explicar en el modo --dry-run.
    """
    haystack = _fold(
        " ".join(filter(None, [
            _url_text(url), title, anchor_text, filename, (page_text or "")[:4000],
        ]))
    )
    positive = {**BASE_POSITIVE_TERMS, **(extra_positive or {})}
    negative = {**BASE_NEGATIVE_TERMS, **(extra_negative or {})}
    score = 0
    matched: list[str] = []
    for term, weight in positive.items():
        if _fold(term) in haystack:
            score += weight
            matched.append(f"+{weight}:{term}")
    for term, weight in negative.items():
        if _fold(term) in haystack:
            score += weight
            matched.append(f"{weight}:{term}")
    return score, matched


def _is_probable_index_page(url: str, depth: int) -> bool:
    if depth <= 1:
        return True
    path = _fold(unquote(urlsplit(url).path))
    return any(hint in path for hint in INDEX_HINT_TERMS)


def should_crawl_url(
    *, url: str, anchor_text: str = "", title: str = "", depth: int, mode: str,
    allowed_paths: tuple[str, ...] = (), min_score: int = 0,
    high_priority: dict[str, int] | None = None,
    blacklist: dict[str, int] | None = None, is_seed: bool = False,
) -> tuple[bool, str, int]:
    """Nivel A: decide si una URL de pagina HTML se agrega a la cola del crawler."""
    if is_seed:
        return True, "seed_o_pagina_inicial", 0

    if mode == "normative":
        if allowed_paths:
            path = _fold(urlsplit(url).path)
            if not any(path.startswith(_fold(prefix)) for prefix in allowed_paths):
                return False, "fuera_de_allowed_paths", 0
        return True, "dentro_de_allowed_paths_normativos", 0

    if mode == "selective_normative":
        score, matched = relevance_score(
            url=url, title=title, anchor_text=anchor_text,
            extra_positive=high_priority, extra_negative=blacklist,
        )
        reasons = ",".join(matched) or "sin_coincidencias"
        if score >= min_score:
            return True, f"score_suficiente(score={score}:{reasons})", score
        if _is_probable_index_page(url, depth):
            return True, f"pagina_indice_para_descubrimiento(score={score})", score
        return False, f"score_insuficiente(score={score}:{reasons})", score

    return True, "modo_general_sin_filtro", 0


def should_download_document(
    *, url: str, filename: str = "", anchor_text: str = "", source_page_title: str = "",
    extension: str, mode: str, min_score: int = 0,
    high_priority: dict[str, int] | None = None,
    blacklist: dict[str, int] | None = None,
    exclude_phrases: tuple[str, ...] = (),
    allowed_document_types: tuple[str, ...] = (),
    min_year: int = 0,
) -> tuple[bool, str, int]:
    """Nivel B: decide si un adjunto detectado se descarga."""
    if extension not in DOCUMENT_EXTENSIONS:
        return False, "extension_no_permitida", 0

    document_text = _fold(re.sub(r"[-_]+", " ", " ".join((
        _url_text(url), filename, anchor_text, source_page_title,
    ))))
    for phrase in exclude_phrases:
        if _fold(phrase) in document_text:
            return False, f"frase_excluida:{phrase}", 0

    # Solo rechaza cuando se identifica un anio explicito (p.ej. "acuerdo-112-
    # de-1905"); un documento sin anio detectable no se descarta por esto para
    # evitar falsos positivos.
    if min_year:
        dated = classify_document(_url_text(url), filename, anchor_text, source_page_title)
        if dated.year and int(dated.year) < min_year:
            return False, f"anterior_a_{min_year}:{dated.year}", 0

    # La lista blanca se evalua sin el titulo de la pagina fuente. Una pagina
    # llamada "Resoluciones" no debe convertir un anexo de nombre generico en
    # una resolucion. Si el archivo/enlace no identifica su tipo, se descarta.
    allowed_type = ""
    if allowed_document_types:
        classification = classify_document(filename, anchor_text)
        allowed_type = classification.document_type
        if allowed_type not in allowed_document_types:
            document_type = allowed_type or "no_identificado"
            return False, f"tipo_documental_no_permitido:{document_type}", 0

    score, matched = relevance_score(
        url=url, title=source_page_title, anchor_text=anchor_text, filename=filename,
        extra_positive=high_priority, extra_negative=blacklist,
    )
    reasons = ",".join(matched) or "sin_coincidencias"
    suffix = f"(score={score}:{reasons})"

    if mode == "normative":
        return True, f"fuente_normativa_exhaustiva{suffix}", score

    if mode == "selective_normative":
        if allowed_type:
            return True, f"tipo_documental_permitido:{allowed_type}{suffix}", score
        threshold = min_score - 2 if extension in HIGH_PRIORITY_EXTENSIONS else min_score
        if score >= threshold:
            return True, f"score_suficiente{suffix}", score
        return False, f"score_insuficiente{suffix}", score

    return True, f"modo_general_sin_filtro{suffix}", score


@dataclass(slots=True)
class DocumentClassification:
    document_type: str = ""
    document_number: str = ""
    year: str = ""


def classify_document(*texts: str) -> DocumentClassification:
    """Detecta tipo/numero/anio por regex. Sin IA; nunca inventa datos ausentes.

    Admite tanto "Acuerdo No. 008 de 2017" como nombres de archivo con guiones
    bajos ("DECRETO_No._0765_DEL_15_DE_JULIO_DE_2026.pdf"), donde el anio puede
    quedar varias palabras despues del numero (dia y mes de por medio).
    """
    combined = " ".join(t for t in texts if t)
    normalized = re.sub(r"[_\-]+", " ", combined)
    match = _TYPE_NUMBER_RE.search(normalized)
    if match:
        raw_type = match.group(1).lower()
        if raw_type.startswith("res"):
            type_key = "resolucion"
        elif raw_type.startswith("dec"):
            type_key = "decreto"
        elif raw_type.startswith("cir"):
            type_key = "circular"
        else:
            type_key = raw_type
        window = normalized[match.end(): match.end() + 60]
        year_match = _YEAR_RE.search(window) or _YEAR_RE.search(normalized)
        return DocumentClassification(type_key, match.group(2), year_match.group(0) if year_match else "")
    folded = _fold(combined)
    for doc_type, pattern in DOCUMENT_TYPE_PATTERNS.items():
        if re.search(pattern, folded):
            return DocumentClassification(doc_type, "", "")
    return DocumentClassification()

