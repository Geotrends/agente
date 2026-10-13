"""Metadatos estructurados del visor de documentos de GMAS2 (research R9).

El visor arma cada documento con JS en `#area`: una tabla de cabecera (nombre,
código, versión, fecha), el estado en `.estado`, y rejillas jqGrid con los
documentos vinculados ("Documentos Referencia", "Documentos Transversales",
"Registros", "Normatividad") y las relaciones (dependencia y proceso).

Todo eso se extrae del DOM, no del Markdown: la ficha de conocimiento
(RF-C3-IV-05) se verifica comparando directamente contra GMAS2, y una
expresión regular sobre texto ya aplanado no es una base confiable para eso.
Estructura verificada con las fixtures reales de tests/fixtures/gmas2/.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup, Tag

#: Rejillas cuyos documentos son "vinculados" del procedimiento.
GRUPOS_VINCULADOS = ("Documentos Referencia", "Documentos Transversales", "Registros", "Normatividad")

CODIGO = re.compile(r"\b([A-Z]{2,3})\s*[-‐‑‒–−]\s*([A-Z]{1,2})\s*[-‐‑‒–−]\s*(\d{1,5})\b")
VISOR = re.compile(r"VisualizacionDocumento\.public\?documento=(\d+)")
DESCARGA = re.compile(r"downloadFile\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]*)['\"]\s*\)")


def codigo_en(texto: str) -> str | None:
    """Primer código de documento del texto, normalizado ("GT-F-011")."""
    m = CODIGO.search(texto.upper())
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def _texto(tag: Tag | None) -> str:
    return " ".join(tag.get_text(" ", strip=True).split()) if tag else ""


def _valor_etiqueta(area: Tag, etiqueta: str) -> str:
    """Valor de una celda "Etiqueta: valor" de la tabla de cabecera."""
    for span in area.select("span.resalt"):
        if _texto(span).rstrip(":").casefold() == etiqueta.casefold():
            celda = span.find_parent("td")
            return re.sub(r"^[^:]*:\s*", "", _texto(celda)).strip()
    return ""


def _oculta(tag: Tag) -> bool:
    estilo = (tag.get("style") or "").replace(" ", "").lower()
    return "display:none" in estilo


def _rejillas(area: Tag) -> list[tuple[list[str], list[bool], list[list[Tag]]]]:
    """Cada jqGrid como (encabezados, ocultas, filas de celdas)."""
    rejillas = []
    for caja in area.select(".ui-jqgrid"):
        encabezado = caja.select_one(".ui-jqgrid-htable")
        cuerpo = caja.select_one(".ui-jqgrid-btable")
        if encabezado is None or cuerpo is None:
            continue
        ths = encabezado.select("th")
        titulos = [_texto(th) for th in ths]
        ocultas = [_oculta(th) for th in ths]
        filas = [fila.select("td") for fila in cuerpo.select("tr.jqgrow")]
        rejillas.append((titulos, ocultas, filas))
    return rejillas


def _fecha_iso(valor: str) -> str | None:
    m = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", valor)
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else None


def _id_de(url: str) -> str:
    valores = parse_qs(urlsplit(url).query).get("documento", [""])
    return valores[0]


def extraer_metadatos(soup: BeautifulSoup, url: str) -> dict[str, Any]:
    """Metadatos de un documento del visor de GMAS2 (campo `gmas` del informe de corrida)."""
    area = soup.select_one("#area") or soup
    estado = re.sub(r"^[^:]*:\s*", "", _texto(area.select_one(".estado"))).strip()

    vinculados: list[dict[str, str]] = []
    dependencia = ""
    vistos: set[str] = set()
    for titulos, ocultas, filas in _rejillas(area):
        visibles = [t for t, o in zip(titulos, ocultas) if not o]
        grupo = next((g for g in GRUPOS_VINCULADOS if g in visibles), None)
        if "Relaciones" in titulos:
            # La columna oculta "relaciona" dice si la fila es DEPENDENCIAS o PROCESOS.
            for celdas in filas:
                if celdas and _texto(celdas[0]).upper() == "DEPENDENCIAS" and len(celdas) > 1:
                    dependencia = dependencia or _texto(celdas[titulos.index("Relaciones")])
            continue
        if grupo is None:
            continue
        for celdas in filas:
            enlace = next((a for c in celdas for a in c.select("a[href]") if VISOR.search(a.get("href", ""))), None)
            if enlace is None:
                continue
            href = urljoin(url, enlace["href"])
            doc_id = VISOR.search(href).group(1)
            texto_enlace = _texto(enlace)
            codigo = codigo_en(texto_enlace) or codigo_en(" ".join(_texto(c) for c in celdas))
            if not codigo or doc_id in vistos:
                continue
            vistos.add(doc_id)
            nombre = re.sub(r"^\s*" + re.escape(codigo).replace("\\-", r"\s*[-‐‑‒–−]\s*") + r"\s*[-‐‑‒–−]?\s*", "",
                            " ".join(texto_enlace.split()), flags=re.I).strip()
            vinculados.append({
                "codigo": codigo, "nombre": nombre or texto_enlace, "id": doc_id,
                "url": f"https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento={doc_id}",
                "grupo": grupo,
            })

    descarga = None
    for a in area.select("a[href^='javascript:downloadFile']"):
        m = DESCARGA.search(a.get("href", ""))
        if m:
            descarga = urljoin(url, f"downloadFile.public?repositorioArchivo={m.group(1)}&ruta={m.group(2)}")
            break

    return {
        "id": _id_de(url),
        "codigo": codigo_en(_valor_etiqueta(area, "Código")) or "",
        "nombre": _texto(area.select_one(".sbigf")),
        "version": _valor_etiqueta(area, "Versión") or None,
        "fecha_actualizacion": _fecha_iso(_valor_etiqueta(area, "Fecha")),
        "estado": estado,
        "dependencia": dependencia or None,
        "vinculados": vinculados,
        "descarga": descarga,
    }


def estructura_completa(meta: dict[str, Any]) -> bool:
    """¿Trae lo mínimo que la ficha exige? Si no, la página cambió de estructura (RF-C3-IV-04)."""
    return bool(meta.get("codigo") and meta.get("estado") and meta.get("version") and meta.get("fecha_actualizacion"))
