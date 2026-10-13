"""Lista de enlaces administrada desde el panel (SPEC007, RF-C3-AD-14..19).

El kb-worker publica, de forma atomica, un snapshot JSON con los enlaces
vigentes y los quitados (`<output>/runs/config/enlaces.json`). Este modulo SOLO lo
lee: no contiene credenciales de escritura ni codigo ejecutable, y la lista de
hosts permitidos sigue siendo la del codigo desplegado (`sources.HOSTS_PERMITIDOS`).

Sin snapshot (instalacion nueva o corrida manual aislada) se usan las semillas
estaticas de `sources.py`, igual que antes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .sources import host_permitido

# Vive en el volumen de informes (`<salida>/runs/config/`): es el único con escritura del kb-worker.
NOMBRE_SNAPSHOT = Path("runs") / "config" / "enlaces.json"


@dataclass(frozen=True, slots=True)
class SnapshotEnlaces:
    version: int
    hash: str
    vigentes: dict[str, tuple[str, ...]]   # fuente -> URLs semilla
    quitados: tuple[str, ...]              # URLs que ya no se verifican


def _normalizar(url: str) -> str:
    partes = urlsplit(url.strip())
    return f"{partes.scheme}://{(partes.hostname or '').lower()}{partes.path.rstrip('/')}" + (f"?{partes.query}" if partes.query else "")


def cargar_snapshot(output_dir: Path) -> SnapshotEnlaces | None:
    """Lee el snapshot; None si no existe o no es valido (se usan las semillas estaticas)."""
    ruta = Path(output_dir) / NOMBRE_SNAPSHOT
    try:
        crudo = json.loads(ruta.read_text(encoding="utf-8"))
        vigentes: dict[str, list[str]] = {}
        for enlace in crudo["links"]:
            url = str(enlace["url"])
            # Defensa en profundidad: aunque el worker ya valido, el scraper solo visita hosts permitidos.
            if host_permitido(url):
                vigentes.setdefault(str(enlace["source"]), []).append(url)
        quitados = tuple(str(u) for u in crudo.get("removed", []))
        return SnapshotEnlaces(
            version=int(crudo["version"]), hash=str(crudo["hash"]),
            vigentes={k: tuple(v) for k, v in vigentes.items()}, quitados=quitados,
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None


def esta_quitada(url: str, quitados: tuple[str, ...]) -> bool:
    """True si la URL es un enlace quitado o cuelga de el (mismo camino como prefijo)."""
    objetivo = _normalizar(url)
    for q in quitados:
        base = _normalizar(q)
        if objetivo == base or objetivo.startswith(base + "/") or objetivo.startswith(base + "?"):
            return True
    return False
