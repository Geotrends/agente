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
from bs4 import BeautifulSoup

from .gmas2 import estructura_completa, extraer_metadatos
from .html_parser import infer_category, markdown_document, parse_html
from .metadata_store import MetadataStore
from .run_report import Enlace, ErrorEnlace, RunReport
from .enlaces import esta_quitada
from .sources import host_permitido
from .relevance import (
    classify_document, should_crawl_url, should_download_document,
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

    def __init__(
        self, config: ScraperConfig, metadata: MetadataStore | None = None,
        report: RunReport | None = None,
    ):
        self.config = config
        # Informe de corrida compartido por todas las fuentes de la ejecución
        # (contracts/run-report.md). None en usos sueltos y en pruebas antiguas.
        self.report = report
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
        if self.config.render_wait == "load":
            # Visores de mapas: nunca dejan la red inactiva (teselas sin fin).
            self._browser_page.goto(url, wait_until="load", timeout=self.config.request_timeout * 1000)
            if self.config.render_espera_ms:
                self._browser_page.wait_for_timeout(self.config.render_espera_ms)
        else:
            self._browser_page.goto(url, wait_until="networkidle", timeout=self.config.request_timeout * 1000)
        return self._browser_page.content()

    # ── Informe de corrida (contracts/run-report.md) ─────────────────────────

    def _rol(self, item: CrawlItem, es_documento: bool) -> str:
        if self.config.gmas2_recorrido:
            if es_documento:
                return "descarga"
            return "procedimiento" if item.depth == 0 else "vinculado"
        return "documento" if es_documento else "pagina"

    def _resultado(self, url: str, hash_actual: str | None) -> str:
        previo = self.metadata.hash_previo_por_url.get(url)
        if previo is None:
            return "nuevo"
        return "sin_cambios" if previo == hash_actual else "cambio_detectado"

    def _reportar(self, **campos: object) -> None:
        if self.report is None or self.config.dry_run:
            return
        campos.setdefault("fuente", self.config.source_name)
        campos.setdefault("fecha_hora", self._now().isoformat())
        self.report.add(Enlace(**campos))  # type: ignore[arg-type]

    def _reportar_error(self, item: CrawlItem, tipo: str, detalle: str, codigo_http: int | None = None) -> None:
        es_documento = item.document_hint or looks_like_document_url(item.url)
        self._reportar(
            url=item.url, rol=self._rol(item, es_documento), padre=item.parent_url or None,
            titulo=item.link_text or None, resultado="error",
            error=ErrorEnlace(tipo, detalle, codigo_http),
        )

    def _reportar_no_alcanzados(self) -> None:
        """Regla 6: las URLs que la fuente tenía y esta corrida no visitó."""
        if self.report is None or self.config.dry_run:
            return
        vistas = self.report.urls()
        for url in sorted(self.metadata.urls_previas_por_fuente.get(self.config.source_name, set()) - vistas):
            item = CrawlItem(url, 1, "", document_hint=looks_like_document_url(url))
            self._reportar_error(item, "inaccesible", "no alcanzado")

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
            # Enlace quitado desde el panel: no se verifica, no se encola y no se reporta
            # (lo ya publicado se conserva; RF-C3-AD-18).
            if self.config.urls_excluidas and esta_quitada(url, self.config.urls_excluidas):
                continue
            # GMAS2 (research R10): desde un vinculado solo se siguen sus
            # descargas, nunca otros documentos del visor.
            if self.config.gmas2_recorrido and item.depth >= 1 and "downloadFile.public" not in url:
                continue
            candidato = (
                same_allowed_host(url, self.config.document_allowed_hosts)
                or same_allowed_host(url, self.config.allowed_hosts)
            )
            if candidato and not host_permitido(url):
                # Contrato, regla 5: lo que el crawler visitaría pero cae fuera
                # de la lista cerrada de hosts se reporta y no se descarga.
                self._reportar(
                    url=url, rol=self._rol(item, True) if looks_like_document_url(url) else "pagina",
                    padre=response_url, titulo=text or None, resultado="error",
                    error=ErrorEnlace("fuera_de_alcance", "host fuera de la lista permitida"),
                )
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

    def _tamano_previo(self, ruta_relativa: str | None) -> int:
        """Caracteres del cuerpo de la última versión guardada de una página (0 si no hay)."""
        if not ruta_relativa:
            return 0
        try:
            texto = safe_destination(self.config.output_dir, Path(ruta_relativa)).read_text(encoding="utf-8")
        except (OSError, ValueError):
            return 0
        partes = texto.split("\n---\n", 1)
        return len((partes[1] if texto.startswith("---") and len(partes) == 2 else texto).strip())

    def _error_estructura(self, item: CrawlItem, url: str, titulo: str, detalle: str) -> None:
        self.stats["errors"] += 1
        self.logger.warning("[ESTRUCTURA] %s: %s", url, detalle)
        self._reportar(
            url=url, rol=self._rol(item, False), padre=item.parent_url or None, titulo=titulo or None,
            resultado="error", error=ErrorEnlace("estructura_modificada", detalle),
        )

    def _save_page(self, item: CrawlItem, response: requests.Response, html: str) -> list[CrawlItem]:
        page = parse_html(
            html, response.url, self.config.content_selectors,
            title_selectors=self.config.title_selectors,
            title_code_selector=self.config.title_code_selector,
            require_selector_text=self.config.require_selector_text,
            require_text_values=self.config.require_text_values,
        )
        gmas = None
        if self.config.gmas2_recorrido:
            gmas = extraer_metadatos(BeautifulSoup(html, "lxml"), response.url)
        if self.config.gmas2_recorrido and not (gmas and gmas.get("codigo") and gmas.get("estado")):
            # Sin código o sin estado la página no es un documento de GMAS2 que
            # podamos leer: el sitio cambió o devolvió otra cosa (RF-C3-IV-04).
            # No se guarda nada: lo anterior sigue siendo lo validado.
            self._error_estructura(item, response.url, page.title, "faltan el código o el estado del documento")
            return []
        if not page.meets_requirements:
            # Derogado (RF-C3-IV-03): no se guarda ni se siguen sus enlaces,
            # pero queda en el informe para que el kb-worker lo marque y avise.
            self.stats["pages_skipped_filter"] += 1
            self.logger.info("[DEROGADO] %s", response.url)
            self._reportar(
                url=response.url, rol=self._rol(item, False), padre=item.parent_url or None,
                titulo=page.title or None, estado_detectado="derogado",
                resultado=self._resultado(response.url, None) if response.url not in self.metadata.hash_previo_por_url else "sin_cambios",
                gmas=gmas,
            )
            return []
        if self.config.gmas2_recorrido and not estructura_completa(gmas):
            self._error_estructura(item, response.url, page.title, "falta la versión o la fecha del documento")
            return []
        previo = self._tamano_previo(self.metadata.known_page_urls.get(response.url))
        if previo and len(page.markdown.strip()) < previo * self.config.umbral_estructura:
            self._error_estructura(
                item, response.url, page.title,
                f"el contenido cayó a {len(page.markdown.strip())} de {previo} caracteres",
            )
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
            if local_path:
                self._reportar(
                    url=response.url, rol=self._rol(item, False), padre=item.parent_url or None,
                    titulo=page.title or None,
                    estado_detectado="vigente" if self.config.gmas2_recorrido else "no_aplica",
                    resultado=self._resultado(response.url, page.content_hash),
                    hash_contenido=page.content_hash, archivo=local_path, gmas=gmas,
                )
            else:
                self._reportar(
                    url=response.url, rol=self._rol(item, False), padre=item.parent_url or None,
                    titulo=page.title or None, resultado="error",
                    error=ErrorEnlace("estructura_modificada", "pagina sin contenido util"),
                )
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
        result = self.downloader.save(
            response, final_url, item.parent_url, item.link_text,
            infer_category(item.parent_url or final_url), self._now().isoformat(),
            source_name=self.config.source_name,
            document_type=classification.document_type, document_number=classification.document_number,
            year=classification.year, title=item.link_text or Path(filename_guess).stem,
            topic=self._page_categories.get(item.parent_url, ""), relevance_score=score,
        )
        self.metadata.add("documentos", result.row)
        self._reportar(
            url=final_url, rol=self._rol(item, True), padre=item.parent_url or None,
            titulo=item.link_text or Path(filename_guess).stem or None,
            estado_detectado="no_aplica",
            resultado=self._resultado(final_url, str(result.row["sha256"])),
            hash_contenido=str(result.row["sha256"]),
            archivo_original=str(result.row["local_path"]), hash_original=str(result.row["sha256"]),
        )
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
            self._reportar_error(item, "timeout", "tiempo de espera agotado")
        except requests.exceptions.SSLError as error:
            self._record_error(item.url, item.parent_url, "ssl_error", str(error))
            self._reportar_error(item, "inaccesible", "error de certificado TLS")
        except requests.HTTPError as error:
            status = error.response.status_code if error.response is not None else "http"
            self._record_error(item.url, item.parent_url, f"http_{status}", str(error))
            self._reportar_error(item, "http", f"HTTP {status}", status if isinstance(status, int) else None)
        except requests.RequestException as error:
            self._record_error(item.url, item.parent_url, "request_error", str(error))
            self._reportar_error(item, "inaccesible", "la conexión falló")
        except (OSError, ValueError) as error:
            self._record_error(item.url, item.parent_url, type(error).__name__, str(error))
            tipo = "fuera_de_alcance" if "Redirect externo" in str(error) else "inaccesible"
            self._reportar_error(item, tipo, type(error).__name__)
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
        self._reportar_no_alcanzados()
        return manifest


# Alias retrocompatible: el nombre historico del proyecto era de una sola fuente.
AmbientometroCrawler = SourceCrawler
