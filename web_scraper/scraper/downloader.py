from __future__ import annotations

import mimetypes
import re
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

import requests

from .config import ScraperConfig
from .metadata_store import MetadataStore
from .utils import (
    DOCUMENT_EXTENSIONS, extension_from_url, relative_posix, safe_destination,
    sha256_file, slugify, unique_path,
)


MIME_EXTENSIONS = {
    "application/pdf": ".pdf",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/csv": ".csv",
    "application/csv": ".csv",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt",
}
CATEGORY_BY_EXTENSION = {
    ".pdf": "pdf", ".xlsx": "excel", ".xls": "excel", ".csv": "csv",
    ".docx": "word", ".doc": "word", ".pptx": "powerpoint",
    ".ppt": "powerpoint", ".txt": "txt",
    ".png": "imagen", ".jpg": "imagen", ".jpeg": "imagen", ".tif": "imagen", ".tiff": "imagen",
}


def _content_disposition_filename(value: str) -> str:
    utf8 = re.search(r"filename\*=UTF-8''([^;]+)", value, re.I)
    if utf8:
        return unquote(utf8.group(1).strip())
    basic = re.search(r'filename\s*=\s*"?([^";]+)', value, re.I)
    return unquote(basic.group(1).strip()) if basic else ""


def response_filename(
    url: str, headers: requests.structures.CaseInsensitiveDict,
) -> str:
    """Nombre declarado por el servidor, con fallback al basename de la URL."""
    return (
        _content_disposition_filename(headers.get("Content-Disposition", ""))
        or Path(unquote(urlsplit(url).path)).name
    )


def document_extension(url: str, headers: requests.structures.CaseInsensitiveDict) -> str:
    disposition_name = _content_disposition_filename(headers.get("Content-Disposition", ""))
    disposition_extension = Path(disposition_name).suffix.lower()
    if disposition_extension in DOCUMENT_EXTENSIONS:
        return disposition_extension
    mime = headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if mime in MIME_EXTENSIONS:
        return MIME_EXTENSIONS[mime]
    url_extension = extension_from_url(url)
    if url_extension in DOCUMENT_EXTENSIONS:
        return url_extension
    guessed = mimetypes.guess_extension(mime) or ""
    return guessed if guessed in DOCUMENT_EXTENSIONS else ""


def response_is_document(url: str, response: requests.Response) -> bool:
    mime = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
    disposition = response.headers.get("Content-Disposition", "").lower()
    return bool(document_extension(url, response.headers)) or "attachment" in disposition or mime in MIME_EXTENSIONS


@dataclass(slots=True)
class DownloadResult:
    row: dict[str, object]
    duplicate: bool


class DocumentDownloader:
    def __init__(self, config: ScraperConfig, metadata: MetadataStore):
        self.config = config
        self.metadata = metadata

    def save(
        self, response: requests.Response, source_url: str, source_page_url: str,
        link_text: str, category: str, downloaded_at: str, *,
        source_name: str = "ambientometro",
        document_type: str = "", document_number: str = "", year: str = "",
        title: str = "", topic: str = "", relevance_score: int = 0,
    ) -> DownloadResult:
        length_header = response.headers.get("Content-Length")
        if length_header and int(length_header) > self.config.max_file_size_bytes:
            raise ValueError(f"Archivo supera el limite de {self.config.max_file_size_mb} MB")
        extension = document_extension(source_url, response.headers) or ".bin"
        response_name = response_filename(source_url, response.headers)
        raw_stem = Path(response_name or link_text or "documento").stem
        filename = slugify(raw_stem, "documento") + extension

        temp_dir = safe_destination(self.config.output_dir, Path(".tmp"))
        with tempfile.NamedTemporaryFile(dir=temp_dir, delete=False) as temporary:
            temp_path = Path(temporary.name)
            size = 0
            try:
                for chunk in response.iter_content(chunk_size=128 * 1024):
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > self.config.max_file_size_bytes:
                        raise ValueError(f"Archivo supera el limite de {self.config.max_file_size_mb} MB")
                    temporary.write(chunk)
            except Exception:
                temp_path.unlink(missing_ok=True)
                raise
        try:
            self._validate_file(temp_path, extension)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise
        digest = sha256_file(temp_path)
        duplicate_row = self.metadata.known_hashes.get(digest)
        duplicate = duplicate_row is not None
        if duplicate:
            temp_path.unlink(missing_ok=True)
            local_path = str(duplicate_row["local_path"])
            duplicate_of = str(duplicate_row.get("id", ""))
            filename = str(duplicate_row.get("filename", filename))
        else:
            folder = CATEGORY_BY_EXTENSION.get(extension, "otros")
            destination = safe_destination(self.config.content_dir, Path("documentos") / folder / filename)
            destination = unique_path(destination, digest)
            destination.parent.mkdir(parents=True, exist_ok=True)
            temp_path.replace(destination)
            local_path = relative_posix(destination, self.config.output_dir)
            duplicate_of = ""
        row: dict[str, object] = {
            "id": f"doc-{len(self.metadata.rows['documentos']) + 1:06d}",
            "filename": filename,
            "local_path": local_path,
            "extension": extension.lstrip("."),
            "mime_type": response.headers.get("Content-Type", "").split(";", 1)[0],
            "file_size_bytes": size,
            "sha256": digest,
            "source_url": source_url,
            "source_page_url": source_page_url,
            "download_url": source_url,
            "link_text": link_text,
            "category": category,
            "http_status": response.status_code,
            "downloaded_at": downloaded_at,
            "duplicate_of": duplicate_of,
            "source": source_name,
            "document_type": document_type,
            "document_number": document_number,
            "year": year,
            "title": title,
            "topic": topic,
            "relevance_score": relevance_score,
        }
        if not duplicate:
            self.metadata.known_hashes[digest] = {key: str(value) for key, value in row.items()}
        return DownloadResult(row=row, duplicate=duplicate)

    @staticmethod
    def _validate_file(path: Path, extension: str) -> None:
        """Detecta respuestas HTML y contenedores Office (ZIP) truncados."""
        with path.open("rb") as stream:
            signature = stream.read(8)
        if not signature:
            raise ValueError("Archivo vacio o corrupto")
        if signature.lstrip().lower().startswith((b"<html", b"<!doctyp")):
            raise ValueError("El servidor devolvio HTML en lugar del documento")
        if extension == ".pdf" and not signature.startswith(b"%PDF-"):
            raise ValueError("PDF corrupto o respuesta con contenido incorrecto")
        if extension in {".docx", ".xlsx", ".pptx"} and not zipfile.is_zipfile(path):
            raise ValueError(f"{extension} corrupto: contenedor ZIP invalido")
        ole_extensions = {".doc", ".xls", ".ppt"}
        if extension in ole_extensions and signature != bytes.fromhex("D0CF11E0A1B11AE1"):
            raise ValueError(f"{extension} corrupto: firma OLE invalida")
