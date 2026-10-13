from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, Tag
from markdownify import markdownify

from .utils import looks_like_document_url, normalize_url, should_ignore_url, slugify


REMOVE_SELECTORS = (
    "script", "style", "noscript", "template", "svg", "nav", "footer",
    "header", "form", ".site-header-wrap", ".site-footer-wrap", ".breadcrumbs",
    ".elementor-post-navigation", ".social-share", ".cookie-notice",
    "[role=navigation]", "[aria-label*=breadcrumb i]",
)
# Ruido de interfaz que no es contenido (research R8): el indicador de carga de
# jqGrid, los botones de vista del visor de GMAS2 ("Vista Completa", "Acordeón",
# "Pestañas") y las anclas de sus pestañas. Si entrara al texto, además de
# ensuciar las tablas cambiaría la huella de la página sin que el contenido
# cambie (RF-C3-IV-06).
RUIDO_SELECTORS = (".loading", "div.button", "a[href^='#tab']")
#: Columnas técnicas de jqGrid que no son contenido.
COLUMNAS_TECNICAS = {"tiporegistro", "acciones", "relaciona", "id", "ítem", "item"}

MAIN_SELECTORS = (
    "article .entry-content", "main article", "main .entry-content", "article",
    "main", "#content", ".site-content",
)


@dataclass(slots=True)
class ParsedPage:
    title: str
    markdown: str
    links: list[tuple[str, str]]
    category: str
    author: str
    published_date: str
    content_hash: str
    dynamic_suspected: bool
    meets_requirements: bool = True


def _meta(soup: BeautifulSoup, *keys: tuple[str, str]) -> str:
    for attribute, value in keys:
        tag = soup.find("meta", attrs={attribute: value})
        if tag and tag.get("content"):
            return str(tag["content"]).strip()
    return ""


def infer_category(url: str, soup: BeautifulSoup | None = None) -> str:
    if soup:
        breadcrumb = soup.select_one(".breadcrumbs, .breadcrumb, [aria-label*=breadcrumb i]")
        if breadcrumb:
            pieces = [x.get_text(" ", strip=True) for x in breadcrumb.select("a, span")]
            useful = [x for x in pieces if x and x.lower() not in {"inicio", "home", "observatorio"}]
            if useful:
                return slugify(useful[-1], "generica", 60)
    segments = [segment for segment in urlsplit(url).path.split("/") if segment]
    if "observatorio" in segments:
        after = segments[segments.index("observatorio") + 1 :]
        return slugify(after[0], "observatorio", 60) if after else "observatorio"
    return slugify(segments[0], "generica", 60) if segments else "generica"


def parse_html(
    html: str, url: str, content_selectors: tuple[str, ...] = (),
    title_selectors: tuple[str, ...] = (), title_code_selector: str = "",
    require_selector_text: str = "", require_text_values: tuple[str, ...] = (),
) -> ParsedPage:
    soup = BeautifulSoup(html, "lxml")
    title_tag = None
    for selector in title_selectors:
        title_tag = soup.select_one(selector)
        if title_tag is not None:
            break
    title_tag = title_tag or soup.select_one("h1")
    title = (
        _meta(soup, ("property", "og:title"), ("name", "twitter:title"))
        or (title_tag.get_text(" ", strip=True) if title_tag else "")
        or (soup.title.get_text(" ", strip=True) if soup.title else "Sin titulo")
    )
    title = re.sub(
        r"\s*[|–-]\s*(?:Ambient[oó]metro|Geoportal\s+Ambiental(?:\s+Envigado)?).*$",
        "", title, flags=re.I,
    ).strip()
    if title_code_selector:
        code_tag = soup.select_one(title_code_selector)
        code = code_tag.get_text(" ", strip=True) if code_tag else ""
        code = re.sub(r"^[^:]*:\s*", "", code).strip()
        if code:
            title = f"{code} - {title}"

    meets_requirements = True
    if require_selector_text:
        status_tag = soup.select_one(require_selector_text)
        status_text = status_tag.get_text(" ", strip=True) if status_tag else ""
        status_text = re.sub(r"^[^:]*:\s*", "", status_text).strip()
        meets_requirements = status_text.casefold() in {
            value.casefold() for value in require_text_values
        }

    selectors = (*content_selectors, *MAIN_SELECTORS)
    main: Tag | None = None
    for selector in selectors:
        candidate = soup.select_one(selector)
        if candidate is not None:
            main = candidate
            break
    main = main or soup.body or soup
    # Extraer enlaces antes de limpiar; solo se consideran enlaces del contenido principal.
    links: list[tuple[str, str]] = []
    seen: set[str] = set()
    for anchor in main.select("a[href]"):
        normalized = normalize_url(str(anchor.get("href", "")), url)
        if normalized and normalized not in seen:
            link_text = (
                anchor.get_text(" ", strip=True)
                or str(anchor.get("title", "")).strip()
                or str(anchor.get("aria-label", "")).strip()
            )
            links.append((normalized, link_text))
            seen.add(normalized)
    # GMAS2: los adjuntos reales no usan <a href> normal sino
    # href="javascript:downloadFile('consecutivo','ruta')" (ver static/js/util.js);
    # hay que extraer los argumentos y armar la URL real de descarga.
    for anchor in main.select("a[href^='javascript:downloadFile']"):
        match = re.search(
            r"downloadFile\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]*)['\"]\s*\)",
            str(anchor.get("href", "")),
        )
        if not match:
            continue
        key, ruta = match.groups()
        download_url = normalize_url(f"downloadFile.public?repositorioArchivo={key}&ruta={ruta}", url)
        if download_url and download_url not in seen:
            links.append((download_url, anchor.get_text(" ", strip=True)))
            seen.add(download_url)
    # Algunos sitios (ej. Concejo de Envigado) insertan el PDF de la norma con
    # <embed>/<object> en vez de <a href>; sin esto el crawler nunca lo ve.
    for embed in main.select("embed[src], object[data]"):
        raw_src = str(embed.get("src") or embed.get("data") or "")
        normalized = normalize_url(raw_src, url)
        if normalized and normalized not in seen and looks_like_document_url(normalized):
            links.append((normalized, title))
            seen.add(normalized)

    content = BeautifulSoup(str(main), "lxml")
    for selector in (*REMOVE_SELECTORS, *RUIDO_SELECTORS):
        for node in content.select(selector):
            node.decompose()
    normalizar_tablas(content)
    for image in content.select("img"):
        if not image.get("alt"):
            image.decompose()
    body = content.body or content
    markdown = markdownify(
        str(body), heading_style="ATX", bullets="-", strip=["span"],
        newline_style="BACKSLASH",
    )
    markdown = re.sub(r"\n[ \t]+\n", "\n\n", markdown)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip()
    # Espacios no separables (el visor de GMAS2 los usa en celdas como "20 días"):
    # para el lector y para la búsqueda son espacios normales.
    markdown = markdown.replace("\xa0", " ")
    plain_length = len(body.get_text(" ", strip=True))
    scripts = len(soup.select("script[src]"))
    # Una pagina breve cuyo unico proposito es enlazar un archivo no requiere JS.
    has_document_link = any(looks_like_document_url(link_url) for link_url, _ in links)
    has_page_link = any(not should_ignore_url(link_url) for link_url, _ in links)
    dynamic_suspected = plain_length < 120 and scripts >= 5 and not has_document_link and not has_page_link
    author = _meta(soup, ("name", "author"), ("property", "article:author"))
    published = _meta(
        soup, ("property", "article:published_time"), ("name", "date"),
        ("itemprop", "datePublished"),
    )
    normalized_text = re.sub(r"\s+", " ", body.get_text(" ", strip=True)).casefold()
    return ParsedPage(
        title=title,
        markdown=markdown,
        links=links,
        category=infer_category(url, soup),
        author=author,
        published_date=published,
        content_hash=hashlib.sha256(normalized_text.encode("utf-8")).hexdigest(),
        dynamic_suspected=dynamic_suspected,
        meets_requirements=meets_requirements,
    )


def _oculta(tag: Tag) -> bool:
    return "display:none" in (tag.get("style") or "").replace(" ", "").lower()


def _jqgrid_a_tabla(soup: BeautifulSoup, caja: Tag) -> Tag | None:
    """Une la tabla de encabezados y la de cuerpo de una rejilla jqGrid en una
    sola tabla con <thead>/<tbody>, sin columnas ocultas ni técnicas."""
    encabezado = caja.select_one(".ui-jqgrid-htable")
    cuerpo = caja.select_one(".ui-jqgrid-btable")
    if encabezado is None or cuerpo is None:
        return None
    ths = encabezado.select("th")
    columnas = [
        i for i, th in enumerate(ths)
        if not _oculta(th) and th.get_text(" ", strip=True).casefold() not in COLUMNAS_TECNICAS
    ]
    filas = cuerpo.select("tr.jqgrow")
    if not columnas or not filas:
        return None
    tabla = soup.new_tag("table")
    thead = soup.new_tag("thead")
    tr = soup.new_tag("tr")
    for i in columnas:
        th = soup.new_tag("th")
        th.string = ths[i].get_text(" ", strip=True)
        tr.append(th)
    thead.append(tr)
    tabla.append(thead)
    tbody = soup.new_tag("tbody")
    for fila in filas:
        celdas = fila.find_all("td", recursive=False)
        tr = soup.new_tag("tr")
        for i in columnas:
            td = soup.new_tag("td")
            if i < len(celdas):
                for hijo in list(celdas[i].contents):
                    td.append(hijo)
            tr.append(td)
        tbody.append(tr)
    tabla.append(tbody)
    return tabla


def _celdas_propias(tabla: Tag) -> list[Tag]:
    return [c for c in tabla.find_all(["td", "th"]) if c.find_parent("table") is tabla]


def normalizar_tablas(soup: BeautifulSoup) -> None:
    """Normaliza el HTML antes de markdownify para que las tablas lleguen
    íntegras (RF-C3-IV-09, research R8):

    1. cada rejilla jqGrid se convierte en UNA tabla limpia (o se elimina si
       está vacía);
    2. una tabla de maquetación que contiene otras tablas se desenvuelve: sus
       celdas pasan a ser bloques y las tablas internas quedan sueltas —si no,
       markdownify mete la tabla entera dentro de una celda—;
    3. un <thead> escrito con <td> pasa a <th>, para que la tabla tenga
       encabezado de columnas.
    """
    for caja in soup.select(".ui-jqgrid"):
        tabla = _jqgrid_a_tabla(soup, caja)
        if tabla is None:
            caja.decompose()
        else:
            caja.replace_with(tabla)
    while True:
        exteriores = [t for t in soup.find_all("table") if t.find("table")]
        if not exteriores:
            break
        # Primero las más internas, para no mover una tabla que aún contiene otra.
        tabla = next(t for t in exteriores if not any(x.find("table") for x in t.find_all("table")))
        bloque = soup.new_tag("div")
        for celda in _celdas_propias(tabla):
            contenedor = soup.new_tag("div")
            for hijo in list(celda.contents):
                contenedor.append(hijo)
            bloque.append(contenedor)
        tabla.replace_with(bloque)
    for thead in soup.select("thead"):
        for td in thead.find_all("td"):
            td.name = "th"


def markdown_document(page: ParsedPage, url: str, scraped_at: datetime) -> str:
    def quote(value: str) -> str:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'

    fields = [
        ("title", page.title), ("source_url", url),
        ("scraped_at", scraped_at.isoformat()), ("category", page.category),
    ]
    if page.author:
        fields.append(("author", page.author))
    if page.published_date:
        fields.append(("published_date", page.published_date))
    frontmatter = "\n".join(f"{key}: {quote(value)}" for key, value in fields)
    heading_present = bool(re.match(r"^#\s+", page.markdown))
    heading = "" if heading_present else f"# {page.title}\n\n"
    return f"---\n{frontmatter}\n---\n\n{heading}{page.markdown}\n"
