from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib import robotparser
from urllib.parse import urlsplit, urlunsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import ScraperConfig
from .downloader import (
    DocumentDownloader, document_extension, response_filename, response_is_document,
)
from .html_parser import infer_category, markdown_document, parse_html
from .metadata_store import MetadataStore
from .relevance import (
    classify_document, concejo_folder_for_type, infer_concejo_document_type,
    should_crawl_url, should_download_document,
)
from .utils import (
    looks_like_document_url, normalize_url, rehost, relative_posix, safe_destination,
    same_allowed_host, should_ignore_url, slugify, unique_path,
)


@dataclass(slots=True)
class CrawlItem:
    url: str
    depth: int
    parent_url: str
    link_text: str = ""
    document_hint: bool = False


class SourceCrawler:
    """Crawler generico dirigido por `ScraperConfig` (una fuente por instancia).

    Reutiliza intacta la logica original del proyecto (BFS, robots.txt,
    deduplicacion por SHA-256, HTML->Markdown); lo nuevo es el filtrado en dos
    niveles de `scraper.relevance` y la organizacion de salida por fuente.
    """

    def __init__(self, config: ScraperConfig, metadata: MetadataStore | None = None):
        self.config = config
        self.config.create_directories()
        self.metadata = metadata or MetadataStore(config.output_dir)
        self.downloader = DocumentDownloader(config, self.metadata)
        self.session = self._build_session()
        self.logger = self._build_logger()
        self.robots = robotparser.RobotFileParser()
        self.visited: set[str] = set()
        self.page_hashes: dict[str, str] = dict(self.metadata.known_page_hashes)
        self._page_titles: dict[str, str] = {}
        self._page_categories: dict[str, str] = {}
        self.stats: dict[str, object] = {
            "pages_visited": 0, "pages_saved_as_markdown": 0,
            "documents_found": 0, "documents_downloaded": 0,
            "duplicates_skipped": 0, "errors": 0,
            "pages_skipped_filter": 0, "documents_skipped_filter": 0,
            "by_document_type": {},
        }
        self.started_at = self._now()
        self._last_request_at = 0.0
        self._playwright = None
        self._browser = None
        self._browser_page = None

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update({"User-Agent": self.config.user_agent, "Accept": "*/*"})
        retries = Retry(
            total=3, connect=3, read=2, status=2, backoff_factor=0.8,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}), respect_retry_after_header=True,
        )
        session.mount("https://", HTTPAdapter(max_retries=retries))
        session.mount("http://", HTTPAdapter(max_retries=retries))
        return session

    def _build_logger(self) -> logging.Logger:
        logger = logging.getLogger(f"corpus.{self.config.source_name}.{id(self)}")
        logger.setLevel(logging.INFO)
        tag = self.config.source_name
        file_formatter = logging.Formatter(f"%(asctime)s %(levelname)s [{tag}] %(message)s")
        console_formatter = logging.Formatter(f"[{tag}] %(message)s")
        file_handler = logging.FileHandler(self.config.output_dir / "logs/scraper.log", encoding="utf-8")
        console_handler = logging.StreamHandler()
        file_handler.setFormatter(file_formatter)
        console_handler.setFormatter(console_formatter)
        logger.addHandler(file_handler)
        logger.addHandler(console_handler)
        logger.propagate = False
        return logger

    @staticmethod
    def _now() -> datetime:
        return datetime.now().astimezone()

    def _setup_robots(self) -> None:
        parts = urlsplit(self.config.start_url)
        robots_url = urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))
        self.robots.set_url(robots_url)
        try:
            self._polite_wait()
            response = self.session.get(
                robots_url, timeout=self.config.request_timeout,
                verify=self.config.ssl_verify,
            )
            response.raise_for_status()
            self.robots.parse(response.text.splitlines())
            self.logger.info("[ROBOTS] %s (%s)", robots_url, response.status_code)
        except requests.RequestException as error:
            # Fallo conservador: se registra. RobotFileParser sin reglas permite continuar.
            self._record_error(robots_url, "", "robots_error", str(error))
            self.robots.parse([])

    def _polite_wait(self) -> None:
        remaining = self.config.delay_between_requests - (time.monotonic() - self._last_request_at)
        if remaining > 0:
            time.sleep(remaining)

    def _fetch(self, url: str) -> requests.Response:
        self._polite_wait()
        try:
            return self.session.get(
                url, timeout=self.config.request_timeout, stream=True,
                allow_redirects=True, verify=self.config.ssl_verify,
            )
        finally:
            self._last_request_at = time.monotonic()

    def _render_html(self, url: str) -> str:
        """Navega `url` en Chromium headless y devuelve el HTML ya renderizado.

        Solo se usa para fuentes SPA (`config.render_js=True`): el HTML crudo
        de `requests` no trae contenido, hay que esperar a que el navegador
        ejecute el JS de la pagina. El navegador se lanza una sola vez por
        crawl y se reutiliza entre paginas.
        """
        if self._browser_page is None:
            from playwright.sync_api import sync_playwright

            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.launch()
            self._browser_page = self._browser.new_page(user_agent=self.config.user_agent)
        self._browser_page.goto(url, wait_until="networkidle", timeout=self.config.request_timeout * 1000)
        return self._browser_page.content()

    def _close_browser(self) -> None:
        if self._browser_page is not None:
            self._browser_page.close()
            self._browser_page = None
        if self._browser is not None:
            self._browser.close()
            self._browser = None
        if self._playwright is not None:
            self._playwright.stop()
            self._playwright = None

    def _record_error(self, url: str, parent: str, error_type: str, message: str) -> None:
        self.stats["errors"] += 1
        self.metadata.add("errores", {
            "url": url, "parent_url": parent, "error_type": error_type,
            "error_message": message[:1000], "timestamp": self._now().isoformat(),
            "source": self.config.source_name,
        })
        self.logger.error("[ERROR] %s %s", error_type, url)

    def _allowed(self, item: CrawlItem) -> bool:
        if should_ignore_url(item.url):
            return False
        if same_allowed_host(item.url, self.config.allowed_hosts):
            return self.robots.can_fetch(self.config.user_agent, item.url)
        # Un host externo solo es valido si el enlace nacio marcado como
        # documento dentro de una pagina oficial. No se permite navegarlo.
        return item.document_hint and same_allowed_host(
            item.url, self.config.document_allowed_hosts,
        )

    def _build_children(self, item: CrawlItem, response_url: str, page_title: str, links: list[tuple[str, str]]) -> list[CrawlItem]:
        children: list[CrawlItem] = []
        if item.depth >= self.config.max_depth:
            return children
        for raw_url, text in links:
            url = rehost(raw_url, self.config.preferred_host)
            if should_ignore_url(url):
                continue
            if same_allowed_host(url, self.config.document_allowed_hosts):
                children.append(CrawlItem(
                    url, item.depth + 1, response_url, text, document_hint=True,
                ))
                continue
            if not same_allowed_host(url, self.config.allowed_hosts):
                continue
            if not self.robots.can_fetch(self.config.user_agent, url):
                self.logger.info("[ROBOTS-SKIP] %s", url)
                continue
            if looks_like_document_url(url):
                # Nivel B (should_download_document) decide en _visit; aqui solo
                # se encola para que el crawler llegue a inspeccionarla.
                children.append(CrawlItem(
                    url, item.depth + 1, response_url, text, document_hint=True,
                ))
                continue
            allow, reason, _ = should_crawl_url(
                url=url, anchor_text=text, title=page_title, depth=item.depth + 1,
                mode=self.config.mode, allowed_paths=self.config.allowed_paths,
                min_score=self.config.min_relevance_score,
                high_priority=self.config.high_priority_keywords,
                blacklist=self.config.blacklist_keywords,
            )
            if self.config.dry_run:
                self.logger.info(
                    "[DRY-RUN][%s] pagina=%s razon=%s",
                    "CRAWL" if allow else "SKIP", url, reason,
                )
            if allow:
                children.append(CrawlItem(url, item.depth + 1, response_url, text))
            else:
                self.stats["pages_skipped_filter"] += 1
        return children

    def _save_page(self, item: CrawlItem, response: requests.Response, html: str) -> list[CrawlItem]:
        page = parse_html(
            html, response.url, self.config.content_selectors,
            title_selectors=self.config.title_selectors,
            title_code_selector=self.config.title_code_selector,
            require_selector_text=self.config.require_selector_text,
            require_text_values=self.config.require_text_values,
        )
        if not page.meets_requirements:
            self.stats["pages_skipped_filter"] += 1
            self.logger.info("[SKIP] no cumple require_selector_text %s", response.url)
            return []
        self._page_titles[response.url] = page.title
        self._page_categories[response.url] = page.category
        scraped_at = self._now()
        if self.config.dry_run:
            local_path = ""
        else:
            duplicate_path = self.page_hashes.get(page.content_hash)
            existing_url_path = self.metadata.known_page_urls.get(response.url)
            if duplicate_path and duplicate_path != existing_url_path:
                local_path = duplicate_path
                self.stats["duplicates_skipped"] += 1
                self.logger.info("[SKIP] pagina duplicada %s", response.url)
            elif len(page.markdown.strip()) < 40:
                local_path = ""
                self.logger.info("[SKIP] pagina sin contenido util %s", response.url)
            else:
                category = slugify(page.category, "generica", 60)
                name = slugify(page.title, Path(urlsplit(response.url).path).stem or "pagina") + ".md"
                destination = (
                    safe_destination(self.config.output_dir, Path(existing_url_path))
                    if existing_url_path
                    else safe_destination(self.config.content_dir, Path("paginas_md") / category / name)
                )
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not existing_url_path:
                    destination = unique_path(destination, page.content_hash)
                destination.write_text(markdown_document(page, response.url, scraped_at), encoding="utf-8")
                local_path = relative_posix(destination, self.config.output_dir)
                self.page_hashes[page.content_hash] = local_path
                self.stats["pages_saved_as_markdown"] += 1
                self.logger.info("[PAGE] %s", response.url)
            self.metadata.add("paginas", {
                "id": f"page-{len(self.metadata.rows['paginas']) + 1:06d}",
                "title": page.title, "url": response.url, "local_md_path": local_path,
                "category": page.category, "depth": item.depth,
                "http_status": response.status_code, "content_length": len(html.encode("utf-8")),
                "content_sha256": page.content_hash, "scraped_at": scraped_at.isoformat(),
                "dynamic_suspected": page.dynamic_suspected, "source": self.config.source_name,
            })
        if page.dynamic_suspected:
            self.logger.warning("[JS?] contenido escaso; revisar manualmente %s", response.url)
        return self._build_children(item, response.url, page.title, page.links)

    def _visit_document(self, item: CrawlItem, response: requests.Response, final_url: str) -> list[CrawlItem]:
        extension = document_extension(final_url, response.headers)
        filename_guess = response_filename(final_url, response.headers)
        source_page_title = self._page_titles.get(item.parent_url, "")
        allow, reason, score = should_download_document(
            url=final_url, filename=filename_guess, anchor_text=item.link_text,
            source_page_title=source_page_title, extension=extension, mode=self.config.mode,
            min_score=self.config.min_relevance_score,
            high_priority=self.config.high_priority_keywords,
            blacklist=self.config.blacklist_keywords,
            exclude_phrases=self.config.document_exclude_phrases,
            allowed_document_types=self.config.allowed_document_types,
            min_year=self.config.min_document_year,
        )
        if self.config.dry_run:
            self.logger.info(
                "[DRY-RUN][%s] documento=%s razon=%s",
                "DOWNLOAD" if allow else "SKIP", final_url, reason,
            )
            if allow:
                self.stats["documents_found"] += 1
            else:
                self.stats["documents_skipped_filter"] += 1
            return []
        if not allow:
            self.stats["documents_skipped_filter"] += 1
            self.logger.info("[FILTER-SKIP] %s razon=%s", final_url, reason)
            return []

        self.stats["documents_found"] += 1
        classification = classify_document(item.link_text, filename_guess, source_page_title)
        folder_override = ""
        if self.config.document_folder_mode == "document_type":
            doc_type = infer_concejo_document_type(final_url, classification.document_type)
            folder_override = concejo_folder_for_type(doc_type)
            classification.document_type = doc_type
        result = self.downloader.save(
            response, final_url, item.parent_url, item.link_text,
            infer_category(item.parent_url or final_url), self._now().isoformat(),
            source_name=self.config.source_name, folder_override=folder_override,
            document_type=classification.document_type, document_number=classification.document_number,
            year=classification.year, title=item.link_text or Path(filename_guess).stem,
            topic=self._page_categories.get(item.parent_url, ""), relevance_score=score,
        )
        self.metadata.add("documentos", result.row)
        label = str(result.row["extension"]).upper() or "FILE"
        if result.duplicate:
            self.stats["duplicates_skipped"] += 1
            self.logger.info("[SKIP] duplicate %s", final_url)
        else:
            self.stats["documents_downloaded"] += 1
            type_key = classification.document_type or "otros"
            by_type = self.stats["by_document_type"]
            by_type[type_key] = by_type.get(type_key, 0) + 1
            self.logger.info("[%s] %s", label, result.row["filename"])
        return []

    def _visit(self, item: CrawlItem) -> list[CrawlItem]:
        visited_at = self._now().isoformat()
        response: requests.Response | None = None
        try:
            response = self._fetch(item.url)
            final_url = normalize_url(response.url)
            if final_url:
                final_url = rehost(final_url, self.config.preferred_host)
            final_host_allowed = bool(final_url) and (
                same_allowed_host(final_url, self.config.allowed_hosts)
                or (
                    item.document_hint
                    and same_allowed_host(final_url, self.config.document_allowed_hosts)
                )
            )
            if not final_url or not final_host_allowed:
                raise ValueError(f"Redirect externo bloqueado: {response.url}")
            content_type = response.headers.get("Content-Type", "")
            self.metadata.add("urls_visitadas", {
                "url": item.url, "normalized_url": final_url, "depth": item.depth,
                "status": response.status_code, "content_type": content_type,
                "parent_url": item.parent_url, "visited_at": visited_at,
                "source": self.config.source_name,
            })
            response.raise_for_status()
            if response_is_document(final_url, response):
                return self._visit_document(item, response, final_url)
            if item.document_hint and not same_allowed_host(final_url, self.config.allowed_hosts):
                raise ValueError(
                    "El enlace externo permitido no devolvio un documento "
                    f"(Content-Type: {content_type or 'ausente'})"
                )
            if "html" not in content_type.lower() and not looks_like_document_url(final_url):
                raise ValueError(f"MIME inesperado: {content_type or 'ausente'}")
            self.stats["pages_visited"] += 1
            if self.config.render_js:
                html = self._render_html(final_url)
            else:
                encoding = response.encoding or response.apparent_encoding or "utf-8"
                response.encoding = encoding
                html = response.text
            return self._save_page(item, response, html)
        except requests.Timeout as error:
            self._record_error(item.url, item.parent_url, "timeout", str(error))
        except requests.exceptions.SSLError as error:
            self._record_error(item.url, item.parent_url, "ssl_error", str(error))
        except requests.HTTPError as error:
            status = error.response.status_code if error.response is not None else "http"
            self._record_error(item.url, item.parent_url, f"http_{status}", str(error))
        except requests.RequestException as error:
            self._record_error(item.url, item.parent_url, "request_error", str(error))
        except (OSError, ValueError) as error:
            self._record_error(item.url, item.parent_url, type(error).__name__, str(error))
        finally:
            if response is not None:
                response.close()
        return []

    def crawl(self) -> dict[str, object]:
        try:
            return self._crawl()
        finally:
            self._close_browser()

    def _crawl(self) -> dict[str, object]:
        self._setup_robots()
        seen_starts: set[str] = set()
        normalized_starts: list[str] = []
        for raw_url in (self.config.start_url, *self.config.related_seed_urls):
            normalized = normalize_url(raw_url)
            if normalized:
                normalized = rehost(normalized, self.config.preferred_host)
            if normalized and normalized not in seen_starts:
                seen_starts.add(normalized)
                normalized_starts.append(normalized)
        if not normalized_starts:
            raise ValueError("start_url invalida")
        queue: deque[CrawlItem] = deque(
            CrawlItem(url, 0, "", "" if index == 0 else "Seccion relacionada")
            for index, url in enumerate(normalized_starts)
        )
        while queue:
            item = queue.popleft()
            normalized = normalize_url(item.url)
            if normalized:
                normalized = rehost(normalized, self.config.preferred_host)
            if not normalized or normalized in self.visited or item.depth > self.config.max_depth:
                continue
            if self.config.max_pages is not None and len(self.visited) >= self.config.max_pages:
                self.logger.warning("[LIMIT] max_pages=%s", self.config.max_pages)
                break
            normalized_item = CrawlItem(
                normalized, item.depth, item.parent_url, item.link_text,
                document_hint=item.document_hint,
            )
            if not self._allowed(normalized_item):
                self._record_error(normalized, item.parent_url, "robots_disallowed", "URL omitida por robots.txt o filtro")
                continue
            self.visited.add(normalized)
            children = self._visit(normalized_item)
            # Mantener BFS para paginas, pero atender primero adjuntos evidentes: asi
            # no quedan PDF al final de una biblioteca con cientos de indices HTML.
            documents = [
                child for child in children
                if child.document_hint or looks_like_document_url(child.url)
            ]
            pages = [
                child for child in children
                if not child.document_hint and not looks_like_document_url(child.url)
            ]
            queue.extendleft(reversed(documents))
            queue.extend(pages)
            if not self.config.dry_run:
                self.metadata.flush()
        manifest: dict[str, object] = {
            "source": self.config.source_name,
            "mode": self.config.mode,
            "dry_run": self.config.dry_run,
            "start_url": self.config.start_url,
            "scrape_started_at": self.started_at.isoformat(),
            "scrape_finished_at": self._now().isoformat(),
            **self.stats,
            "unique_urls_processed": len(self.visited),
            "output_dir": str(self.config.output_dir),
        }
        if not self.config.dry_run:
            self.metadata.flush()
        return manifest


# Alias retrocompatible: el nombre historico del proyecto era de una sola fuente.
AmbientometroCrawler = SourceCrawler
