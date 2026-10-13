from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


FIELDS = {
    "documentos": [
        "id", "filename", "local_path", "extension", "mime_type",
        "file_size_bytes", "sha256", "source_url", "source_page_url",
        "download_url", "link_text", "category", "http_status", "downloaded_at",
        "duplicate_of", "source", "document_type", "document_number", "year",
        "title", "topic", "relevance_score",
    ],
    "paginas": [
        "id", "title", "url", "local_md_path", "category", "depth",
        "http_status", "content_length", "content_sha256", "scraped_at",
        "dynamic_suspected", "source",
    ],
    "urls_visitadas": [
        "url", "normalized_url", "depth", "status", "content_type",
        "parent_url", "visited_at", "source",
    ],
    "errores": ["url", "parent_url", "error_type", "error_message", "timestamp", "source"],
}

# Antes del crawler multi-fuente solo existia "ambientometro"; las filas
# historicas sin columna "source" pertenecen a esa fuente.
_LEGACY_DEFAULT_SOURCE = "ambientometro"


class MetadataStore:
    def __init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.directory = output_dir / "metadata"
        self.rows: dict[str, list[dict[str, Any]]] = {name: [] for name in FIELDS}
        self.known_hashes: dict[str, dict[str, str]] = {}
        self.document_associations: set[tuple[str, str, str]] = set()
        self._load_existing_documents()
        self.known_page_urls: dict[str, str] = {}
        self.known_page_hashes: dict[str, str] = {}
        self._load_existing_pages()
        self._load_existing_urls_visitadas()
        self._load_existing_errores()
        # Foto de la corrida ANTERIOR, tomada al cargar: el informe de corrida
        # compara contra ella (nuevo / sin_cambios / cambio_detectado) y con
        # ella sabe qué URLs de cada fuente no se alcanzaron (contrato, regla 6).
        self.hash_previo_por_url: dict[str, str] = {}
        self.urls_previas_por_fuente: dict[str, set[str]] = {}
        for row in self.rows["paginas"]:
            if row.get("url") and row.get("content_sha256"):
                self.hash_previo_por_url[row["url"]] = row["content_sha256"]
                self.urls_previas_por_fuente.setdefault(row.get("source", ""), set()).add(row["url"])
        for row in self.rows["documentos"]:
            if row.get("source_url") and row.get("sha256"):
                self.hash_previo_por_url[row["source_url"]] = row["sha256"]
                self.urls_previas_por_fuente.setdefault(row.get("source", ""), set()).add(row["source_url"])

    def _load_existing_documents(self) -> None:
        path = self.directory / "documentos.csv"
        if not path.exists():
            return
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                digest = row.get("sha256", "")
                local_path = row.get("local_path", "")
                if digest and local_path and (self.output_dir / local_path).is_file():
                    # Conservar el catalogo historico para no olvidar archivos que no
                    # vuelvan a aparecer en una corrida posterior.
                    if not row.get("source"):
                        row["source"] = _LEGACY_DEFAULT_SOURCE
                    self.rows["documentos"].append(row)
                    self.document_associations.add(
                        (digest, row.get("source_url", ""), row.get("source_page_url", ""))
                    )
                    if not row.get("duplicate_of"):
                        self.known_hashes[digest] = row

    def _load_existing_pages(self) -> None:
        path = self.directory / "paginas.csv"
        if not path.exists():
            return
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                local_path = row.get("local_md_path", "")
                if not local_path or not (self.output_dir / local_path).is_file():
                    continue
                if not row.get("source"):
                    row["source"] = _LEGACY_DEFAULT_SOURCE
                # Conservar el catalogo historico (hallazgo A-7): sin esto, una
                # corrida sobre una fuente nueva reescribia paginas.csv solo con
                # las filas de esa corrida y borraba titulo y URL de las demas.
                self.rows["paginas"].append(row)
                if row.get("url"):
                    self.known_page_urls[row["url"]] = local_path
                if row.get("content_sha256"):
                    self.known_page_hashes[row["content_sha256"]] = local_path

    def _load_existing_urls_visitadas(self) -> None:
        # A diferencia de "documentos" y "paginas", estas filas no estan
        # asociadas a un archivo en disco que pueda faltar: son un registro de
        # rastreo. No existia ningun metodo que las recargara, asi que CADA
        # corrida reescribia el CSV solo con lo visitado en esa corrida —una
        # version mas totalizante del mismo bug de A-7, no solo "el mismo bug".
        path = self.directory / "urls_visitadas.csv"
        if not path.exists():
            return
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                if not row.get("source"):
                    row["source"] = _LEGACY_DEFAULT_SOURCE
                self.rows["urls_visitadas"].append(row)

    def _load_existing_errores(self) -> None:
        # Mismo caso que urls_visitadas: registro de rastreo sin archivo que
        # verificar, y sin ningun metodo de recarga hasta ahora.
        path = self.directory / "errores.csv"
        if not path.exists():
            return
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                if not row.get("source"):
                    row["source"] = _LEGACY_DEFAULT_SOURCE
                self.rows["errores"].append(row)

    def add(self, table: str, row: dict[str, Any]) -> None:
        if table == "documentos":
            key = (
                str(row.get("sha256", "")), str(row.get("source_url", "")),
                str(row.get("source_page_url", "")),
            )
            if key in self.document_associations:
                return
            self.document_associations.add(key)
        self.rows[table].append(row)

    def flush(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        for name, fields in FIELDS.items():
            path = self.directory / f"{name}.csv"
            temporary = path.with_suffix(".csv.tmp")
            with temporary.open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(self.rows[name])
            temporary.replace(path)

    def write_manifest(self, manifest: dict[str, Any]) -> None:
        path = self.directory / "manifest.json"
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
