from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


START_URL = "https://ambientometroenvigado.com/observatorio/"
OUTPUT_DIR = Path("salida")
MAX_DEPTH = 10
REQUEST_TIMEOUT = 30.0
DELAY_BETWEEN_REQUESTS = 0.5
MAX_FILE_SIZE_MB = 200
RELATED_SEED_URLS = ("https://ambientometroenvigado.com/biblioteca-boletines/",)


@dataclass(slots=True)
class ScraperConfig:
    start_url: str = START_URL
    output_dir: Path = OUTPUT_DIR
    max_depth: int = MAX_DEPTH
    request_timeout: float = REQUEST_TIMEOUT
    delay_between_requests: float = DELAY_BETWEEN_REQUESTS
    max_file_size_mb: int = MAX_FILE_SIZE_MB
    user_agent: str = (
        "Mozilla/5.0 (compatible; AmbientometroCorpusCrawler/1.0; "
        "+https://ambientometroenvigado.com/observatorio/)"
    )
    verify_ssl: bool = True
    max_pages: int | None = None
    related_seed_urls: tuple[str, ...] = RELATED_SEED_URLS
    allowed_hosts: set[str] = field(default_factory=set)
    extra_allowed_domains: tuple[str, ...] = ()
    document_allowed_hosts: set[str] = field(default_factory=set)
    document_allowed_domains: tuple[str, ...] = ()

    # --- Multi-fuente (ver scraper/sources.py) ---
    # source_name identifica la fuente en la metadata compartida (columna
    # "source") y en los nombres de carpeta. legacy_flat_layout=True mantiene
    # el layout historico (documentos/, paginas_md/ directo bajo output_dir),
    # que es el que ya usa el corpus en produccion de "ambientometro"; las
    # fuentes nuevas anidan su contenido bajo output_dir/<source_name>/ para
    # quedar claramente separadas sin tocar datos existentes.
    source_name: str = "ambientometro"
    legacy_flat_layout: bool = True
    mode: str = "general_observatory"
    allowed_paths: tuple[str, ...] = ()
    document_folder_mode: str = "extension"
    min_relevance_score: int = 0
    high_priority_keywords: dict[str, int] = field(default_factory=dict)
    blacklist_keywords: dict[str, int] = field(default_factory=dict)
    document_exclude_phrases: tuple[str, ...] = ()
    allowed_document_types: tuple[str, ...] = ()
    min_document_year: int = 0
    content_selectors: tuple[str, ...] = ()
    dry_run: bool = False

    def __post_init__(self) -> None:
        self.output_dir = Path(self.output_dir).expanduser().resolve()
        host = (urlsplit(self.start_url).hostname or "").lower()
        if not host:
            raise ValueError("START_URL debe ser una URL HTTP(S) valida")
        bare = host.removeprefix("www.")
        self.allowed_hosts.update({bare, f"www.{bare}"})
        for domain in self.extra_allowed_domains:
            extra_bare = domain.lower().removeprefix("www.")
            self.allowed_hosts.update({extra_bare, f"www.{extra_bare}"})
        # Estos hosts se pueden usar exclusivamente para descargar enlaces
        # descubiertos en una pagina permitida. No se agregan a allowed_hosts:
        # el crawler nunca recorrera menus ni paginas de esos servicios.
        for domain in self.document_allowed_domains:
            document_bare = domain.lower().removeprefix("www.")
            self.document_allowed_hosts.update({document_bare, f"www.{document_bare}"})
        if self.max_depth < 0 or self.max_file_size_mb <= 0:
            raise ValueError("max_depth y max_file_size_mb deben ser positivos")

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    @property
    def preferred_host(self) -> str:
        """Host literal declarado en start_url (con o sin "www."), para `utils.rehost`."""
        return (urlsplit(self.start_url).hostname or "").lower()

    @property
    def content_dir(self) -> Path:
        """Raiz de documentos/ y paginas_md/ para esta fuente."""
        return self.output_dir if self.legacy_flat_layout else self.output_dir / self.source_name

    def create_directories(self) -> None:
        for relative in (
            "documentos/pdf", "documentos/excel", "documentos/word",
            "documentos/powerpoint", "documentos/csv", "documentos/txt",
            "documentos/otros", "paginas_md/generica",
        ):
            (self.content_dir / relative).mkdir(parents=True, exist_ok=True)
        for relative in ("metadata", "logs", ".tmp"):
            (self.output_dir / relative).mkdir(parents=True, exist_ok=True)
