from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit


TRACKING_PARAMS = {
    "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source",
}
IGNORED_PATH_PREFIXES = (
    "/wp-admin", "/wp-login", "/wp-json", "/xmlrpc.php", "/feed",
    "/comments", "/carrito", "/cart", "/checkout",
)
# Imágenes que se adquieren como documento (para OCR, RF-C3-IV-08) solo cuando
# llegan como enlace explícito (<a href>) del contenido principal; las <img> de
# una página nunca se descargan (html_parser solo recoge <a>, <embed>, <object>).
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
DOCUMENT_EXTENSIONS = {
    ".pdf", ".xlsx", ".xls", ".csv", ".docx", ".doc", ".pptx",
    ".ppt", ".txt",
} | IMAGE_EXTENSIONS
NON_TARGET_ASSET_EXTENSIONS = {
    ".7z", ".avi", ".bmp", ".css", ".eot", ".gif", ".ico",
    ".js", ".json", ".map", ".mkv", ".mov", ".mp3", ".mp4",
    ".ogg", ".rar", ".svg", ".ttf", ".webm", ".webp", ".woff",
    ".woff2", ".xml", ".zip",
}


def normalize_url(url: str, base_url: str | None = None) -> str | None:
    absolute = urljoin(base_url or "", url.strip())
    parts = urlsplit(absolute)
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        return None
    host = parts.hostname.lower().removeprefix("www.")
    port = f":{parts.port}" if parts.port and parts.port not in {80, 443} else ""
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    # WordPress sirve sus paginas con slash final; unificar ambas variantes.
    if not PurePosixPath(path).suffix and not path.endswith("/"):
        path += "/"
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in TRACKING_PARAMS
    ]
    # El sitio canonico usa HTTPS y redirige sus enlaces historicos HTTP. Unificar el
    # esquema evita visitar dos veces el mismo contenido.
    return urlunsplit(("https", host + port, path, urlencode(sorted(query)), ""))


def rehost(url: str, preferred_host: str) -> str:
    """Reescribe el host de `url` a `preferred_host` si son la misma fuente.

    `normalize_url` siempre quita "www." para deduplicar paginas. Algunos
    sitios .gov.co solo resuelven o solo sirven contenido bajo "www.": sin
    esto, cada solicitud saliente terminaria golpeando el dominio equivocado
    aunque `start_url` haya declarado el host correcto.
    """
    if not preferred_host:
        return url
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if not host or host.removeprefix("www.") != preferred_host.lower().removeprefix("www."):
        return url
    port = f":{parts.port}" if parts.port and parts.port not in {80, 443} else ""
    return urlunsplit((parts.scheme, preferred_host.lower() + port, parts.path, parts.query, parts.fragment))


def same_allowed_host(url: str, allowed_hosts: set[str]) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return host in allowed_hosts or host.removeprefix("www.") in allowed_hosts


def should_ignore_url(url: str) -> bool:
    parts = urlsplit(url)
    path = parts.path.lower()
    if path.startswith(IGNORED_PATH_PREFIXES):
        return True
    if PurePosixPath(path).suffix.lower() in NON_TARGET_ASSET_EXTENSIONS:
        return True
    return any(key.lower() in {"add-to-cart", "remove_item"} for key, _ in parse_qsl(parts.query))


def extension_from_url(url: str) -> str:
    return PurePosixPath(urlsplit(url).path).suffix.lower()


def looks_like_document_url(url: str) -> bool:
    return extension_from_url(url) in DOCUMENT_EXTENSIONS


def slugify(value: str, fallback: str = "sin_titulo", max_length: int = 110) -> str:
    value = unicodedata.normalize("NFKC", value).strip().lower()
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", " ", value)
    value = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE)
    value = re.sub(r"_+", "_", value).strip("._-")
    return (value[:max_length].rstrip("._-") or fallback)


def safe_destination(root: Path, relative: Path) -> Path:
    destination = (root / relative).resolve()
    if destination != root and root not in destination.parents:
        raise ValueError(f"Ruta fuera de OUTPUT_DIR: {relative}")
    return destination


def unique_path(path: Path, discriminator: str = "") -> Path:
    if not path.exists():
        return path
    suffix = f"_{discriminator[:8]}" if discriminator else "_2"
    candidate = path.with_name(f"{path.stem}{suffix}{path.suffix}")
    index = 3
    while candidate.exists():
        candidate = path.with_name(f"{path.stem}_{index}{path.suffix}")
        index += 1
    return candidate


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative_posix(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()
