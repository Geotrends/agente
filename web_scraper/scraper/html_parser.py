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
) -> ParsedPage:
    soup = BeautifulSoup(html, "lxml")
    title_tag = soup.select_one("h1")
    title = (
        _meta(soup, ("property", "og:title"), ("name", "twitter:title"))
        or (title_tag.get_text(" ", strip=True) if title_tag else "")
        or (soup.title.get_text(" ", strip=True) if soup.title else "Sin titulo")
    )
    title = re.sub(
        r"\s*[|–-]\s*(?:Ambient[oó]metro|Geoportal\s+Ambiental(?:\s+Envigado)?).*$",
        "", title, flags=re.I,
    ).strip()

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
    # Algunos sitios (ej. Concejo de Envigado) insertan el PDF de la norma con
    # <embed>/<object> en vez de <a href>; sin esto el crawler nunca lo ve.
    for embed in main.select("embed[src], object[data]"):
        raw_src = str(embed.get("src") or embed.get("data") or "")
        normalized = normalize_url(raw_src, url)
        if normalized and normalized not in seen and looks_like_document_url(normalized):
            links.append((normalized, title))
            seen.add(normalized)

    content = BeautifulSoup(str(main), "lxml")
    for selector in REMOVE_SELECTORS:
        for node in content.select(selector):
            node.decompose()
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
    )


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
