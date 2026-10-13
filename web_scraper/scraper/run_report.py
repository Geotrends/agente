"""Informe de corrida: la frontera entre el scraper y el kb-worker (research R1).

El scraper adquiere y verifica; NO conoce la matriz documental ni la base de
datos. Todo lo que el kb-worker necesita para aplicar las reglas de alcance,
estado y versiones viaja en este informe, un JSON por ejecución con un
registro por enlace (contracts/run-report.md).

La escritura es atómica: se escribe `<run_id>.json.tmp` y se renombra al
terminar. El kb-worker ignora los `.tmp`, así que nunca procesa un informe a
medio escribir aunque vigile el directorio mientras el scraper trabaja.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

ROLES = {"procedimiento", "vinculado", "descarga", "pagina", "documento"}
ESTADOS = {"vigente", "derogado", "no_aplica"}
RESULTADOS = {"nuevo", "sin_cambios", "cambio_detectado", "error"}
TIPOS_ERROR = {"inaccesible", "http", "estructura_modificada", "timeout", "fuera_de_alcance"}


@dataclass(slots=True)
class ErrorEnlace:
    tipo: str
    detalle: str = ""
    codigo_http: int | None = None

    def __post_init__(self) -> None:
        if self.tipo not in TIPOS_ERROR:
            raise ValueError(f"tipo de error desconocido: {self.tipo!r}")
        # Sin trazas ni rutas: el detalle termina en notificaciones del panel.
        self.detalle = " ".join(self.detalle.split())[:300]


@dataclass(slots=True)
class Enlace:
    url: str
    fuente: str
    fecha_hora: str
    rol: str
    resultado: str
    estado_detectado: str = "no_aplica"
    padre: str | None = None
    titulo: str | None = None
    error: ErrorEnlace | None = None
    hash_contenido: str | None = None
    archivo: str | None = None
    archivo_original: str | None = None
    hash_original: str | None = None
    gmas: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.rol not in ROLES:
            raise ValueError(f"rol desconocido: {self.rol!r}")
        if self.estado_detectado not in ESTADOS:
            raise ValueError(f"estado desconocido: {self.estado_detectado!r}")
        if self.resultado not in RESULTADOS:
            raise ValueError(f"resultado desconocido: {self.resultado!r}")
        if (self.resultado == "error") != (self.error is not None):
            raise ValueError("un enlace con resultado 'error' lleva su error, y solo él")
        if self.resultado == "error":
            # Regla 1 del contrato: un error nunca deja archivo nuevo.
            self.archivo = None
            self.hash_contenido = None


@dataclass
class RunReport:
    fuentes: list[str]
    programada: bool = True
    run_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    iniciada_en: str = field(default_factory=lambda: datetime.now().astimezone().isoformat())
    terminada_en: str | None = None
    completa: bool = True
    enlaces: list[Enlace] = field(default_factory=list)
    _urls: dict[str, int] = field(default_factory=dict, repr=False)

    def add(self, enlace: Enlace) -> None:
        """Registra un enlace. Si la URL ya estaba, gana la última observación,
        salvo que la previa fuera un éxito y la nueva un "no alcanzado" (regla 6)."""
        previo = self._urls.get(enlace.url)
        if previo is None:
            self._urls[enlace.url] = len(self.enlaces)
            self.enlaces.append(enlace)
            return
        anterior = self.enlaces[previo]
        if anterior.resultado != "error" and enlace.error and enlace.error.detalle == "no alcanzado":
            return
        self.enlaces[previo] = enlace

    def urls(self) -> set[str]:
        return set(self._urls)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "run_id": self.run_id,
            "programada": self.programada,
            "iniciada_en": self.iniciada_en,
            "terminada_en": self.terminada_en or datetime.now().astimezone().isoformat(),
            "fuentes": list(self.fuentes),
            "completa": self.completa,
            "enlaces": [asdict(e) for e in self.enlaces],
        }

    def write(self, runs_dir: Path) -> Path:
        """Escribe `<runs_dir>/<run_id>.json` de forma atómica y devuelve la ruta."""
        self.terminada_en = self.terminada_en or datetime.now().astimezone().isoformat()
        runs_dir.mkdir(parents=True, exist_ok=True)
        destino = runs_dir / f"{self.run_id}.json"
        temporal = destino.with_suffix(".json.tmp")
        temporal.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        temporal.replace(destino)
        return destino

