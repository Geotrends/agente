"""Registro de fuentes de la base de conocimiento (RF-C3-IV-01, research R16).

Solo las cuatro fuentes autorizadas: GMAS2 (los 6 procedimientos y sus
vinculados), Ambientómetro (páginas y documentos), las 4 páginas de
envigado.gov.co y el Observatorio de Geotrends. Concejo, MinAmbiente y
MinAgricultura salieron del alcance y se retiraron de aquí para que nadie pueda
reactivarlas por configuración (sus definiciones viven en
tests/fuentes_retiradas.py, solo para pruebas de lógica genérica).

Cada fuente declara sus semillas, dominios y el modo de filtrado que aplica
`scraper.relevance`. Además, todo enlace debe pasar `host_permitido`: la lista
cerrada de hosts de la base, idéntica a la de backend/config/base-conocimiento.json
(lo verifica tests/test_sources_scope.py) y que solo cambia con un despliegue
(RF-C3-AD-15).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

# certs/ vive en la raiz de web_scraper/, un nivel arriba de scraper/.
CERTS_DIR = Path(__file__).resolve().parent.parent / "certs"


# --- Envigado.gov.co (paginas puntuales, acotadas en reunion con cliente) --
# No es crawleo: son 4 URLs fijas de interes, sin seguir enlaces (max_depth=0
# en sources.py -> main.py). Verificado en vivo (2026-09): las 4 responden 200
# HTML publico, sin autenticacion.
ENVIGADO_COM_PAGES = (
    "https://www.envigado.gov.co/politicas-y-lineamientos/servicio-al-ciudadano",
    "https://www.envigado.gov.co/contactenos",
    "https://www.envigado.gov.co/peticiones-quejas-reclamos",
    "https://envigado.gov.co/tema/tramites-y-servicios/secretaria-de-medio-ambiente-y-desarrollo-agropecuario",
)

# --- GMAS2 (sistema de gestion de calidad de Envigado) ---------------------
# Los 6 procedimientos (GT-P) de la base de conocimiento (RF-C3-IV-01). Verificado en vivo via HAR: la app arma cada documento
# con ~5 llamadas AJAX a endpoints "*.public" (getDocumentoCalidadInfo,
# getDocumentoControlInfo, getDocumentoRelacionGrid, getDocumentoTableGrid,
# getCampoActividadCols), TODAS sin cookies ni sesion -- ".public" es literal,
# no requieren el login que el cliente indico (usuario/clave "consulta"). Se
# renderiza igual que envigado_com (SPA/JS), no hace falta implementar login.
GMAS2_DOCUMENT_IDS = (
    "0000010207",  # GT-P-004  Gestión Ambiental
    "0000010446",  # GT-P-011  Bienestar Animal
    "0000002145",  # GT-P-020  Bienestar Animal
    "0000010445",  # GT-P-021  Bienestar Animal
    "0000002147",  # GT-P-027  Bienestar Animal
    "0000004622",  # GT-P-029  Ecosistemas (agregado en el bloque 1)
)
GMAS2_PAGES = tuple(
    f"https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento={doc_id}"
    for doc_id in GMAS2_DOCUMENT_IDS
)

# Retraso minimo (segundos) entre solicitudes, por fuente.
SOURCE_DELAYS: dict[str, float] = {
    "ambientometro": 0.5,
    "envigado_com": 0.7,
    "gmas2_envigado": 0.7,
    "observatorio_geotrends": 0.7,
}

# --- Hosts permitidos de la base (RF-C3-IV-01, RF-C3-AD-15) ------------------
# Lista cerrada. "dominio_con_subdominios" acepta el dominio y todo host que
# termine en ".<dominio>"; "host_exacto" solo ese host. Debe ser IDENTICA a
# hosts_permitidos de backend/config/base-conocimiento.json.
HOSTS_PERMITIDOS: tuple[tuple[str, str], ...] = (
    ("envigado.gov.co", "dominio_con_subdominios"),
    ("www.concejoenvigado.gov.co", "host_exacto"),
    ("observatorioenvigado.geotrends.co", "host_exacto"),
    ("ambientometroenvigado.com", "host_exacto"),
)


def host_permitido(url: str) -> bool:
    """True si la URL es https y su host esta en HOSTS_PERMITIDOS."""
    partes = urlsplit(url)
    if partes.scheme != "https":
        return False
    host = (partes.hostname or "").lower()
    for permitido, tipo in HOSTS_PERMITIDOS:
        if host == permitido or (tipo == "dominio_con_subdominios" and host.endswith("." + permitido)):
            return True
    return False


@dataclass(frozen=True, slots=True)
class SourceDefinition:
    name: str
    start_urls: tuple[str, ...]
    allowed_domains: tuple[str, ...]
    mode: str  # "general_observatory" | "normative" | "selective_normative"
    allowed_paths: tuple[str, ...] = ()
    related_seed_urls: tuple[str, ...] = ()
    delay: float = 0.7
    max_depth: int = 10
    min_relevance_score: int = 0
    high_priority_keywords: dict[str, int] = field(default_factory=dict)
    blacklist_keywords: dict[str, int] = field(default_factory=dict)
    document_exclude_phrases: tuple[str, ...] = ()
    allowed_document_types: tuple[str, ...] = ()
    # 0 = sin filtro. Rechaza documentos cuyo anio detectado (via classify_document
    # sobre URL/filename/anchor/titulo) sea anterior a este valor. No descarta
    # documentos sin anio identificable, para evitar falsos positivos.
    min_document_year: int = 0
    content_selectors: tuple[str, ...] = ()
    # Dominios externos que solo pueden recibir solicitudes a enlaces
    # descubiertos dentro de una pagina oficial. Nunca se navegan como HTML.
    document_allowed_domains: tuple[str, ...] = ()
    legacy_flat_layout: bool = False
    user_agent: str = ""  # vacio = usar el user_agent transparente por defecto
    # Ruta a un PEM extra (relativa a web_scraper/) para sitios que no envian
    # su certificado intermedio. Vacio = validar solo con certifi.
    ca_bundle: str = ""
    # true = renderizar con Playwright/Chromium (sitio SPA que pinta el
    # contenido con JS y no lo trae en el HTML crudo).
    render_js: bool = False
    title_selectors: tuple[str, ...] = ()
    title_code_selector: str = ""
    require_selector_text: str = ""
    require_text_values: tuple[str, ...] = ()
    # GMAS2 (research R10): desde un GT-P semilla se siguen sus vinculados; desde
    # un vinculado, SOLO sus descargas. Reemplaza el recorrido por profundidad.
    gmas2_recorrido: bool = False
    # Como esperar el render JS: "networkidle" (defecto) o "load" + una espera
    # fija, para paginas que nunca dejan la red inactiva (visores de mapas).
    render_wait: str = "networkidle"
    render_espera_ms: int = 0


SOURCES: dict[str, SourceDefinition] = {
    "ambientometro": SourceDefinition(
        name="ambientometro",
        start_urls=("https://ambientometroenvigado.com/observatorio/",),
        allowed_domains=("ambientometroenvigado.com",),
        mode="general_observatory",
        related_seed_urls=("https://ambientometroenvigado.com/biblioteca-boletines/",),
        delay=SOURCE_DELAYS["ambientometro"],
        # A partir de ahora anida bajo su propia carpeta, igual que las demas
        # fuentes. Los archivos que ya existian antes de este cambio (layout
        # plano, directo bajo OUTPUT_DIR) se dejan donde estan: el dedup por
        # SHA-256 los sigue reconociendo via metadata/documentos.csv, solo lo
        # nuevo que se descubra de aqui en adelante cae en ambientometro/.
        legacy_flat_layout=False,
    ),
    "envigado_com": SourceDefinition(
        name="envigado_com",
        start_urls=ENVIGADO_COM_PAGES,
        allowed_domains=("envigado.gov.co", "www.envigado.gov.co"),
        mode="normative",
        delay=SOURCE_DELAYS["envigado_com"],
        # max_depth=0: se descargan solo estas 4 URLs, sin seguir enlaces. El
        # alcance quedo acotado en reunion con el cliente a estas paginas
        # puntuales, no a un crawleo del sitio.
        max_depth=0,
        # Verificado en vivo (2026-09): el servidor no envia su certificado
        # intermedio (GlobalSign GCC R46 OV TLS CA 2025), solo el hoja. curl/
        # macOS lo completan via AIA pero requests+certifi no, y fallan con
        # CERTIFICATE_VERIFY_FAILED. Se agrega el intermedio manualmente
        # (su raiz, GlobalSign Root R46, si esta en certifi).
        ca_bundle=str(CERTS_DIR / "globalsign_gcc_r46_ov_tls_ca_2025.pem"),
        # Verificado en vivo: el sitio es un SPA Angular (<app-root></app-root>);
        # el HTML que devuelve el servidor no trae contenido, solo el cascaron
        # que despues pinta JS en el navegador. Sin renderizado, el parser ve
        # la pagina como "sin contenido util" y la descarta.
        render_js=True,
    ),
    "gmas2_envigado": SourceDefinition(
        name="gmas2_envigado",
        start_urls=GMAS2_PAGES,
        allowed_domains=("gmas2.envigado.gov.co",),
        mode="normative",
        # Todo el espacio de rutas vive bajo /gmas/: paginas de documento
        # (VisualizacionDocumento.public) y descargas reales (downloadFile.public).
        allowed_paths=("/gmas/",),
        delay=SOURCE_DELAYS["gmas2_envigado"],
        # Recorrido acotado (RF-C3-IV-01, research R10): GT-P (profundidad 0)
        # -> sus vinculados (1) -> las descargas de esos vinculados (2). Solo
        # entran los documentos citados dentro de los 6 GT-P, no el grafo
        # completo de "documentos asociados al proceso".
        max_depth=2,
        gmas2_recorrido=True,
        # Igual que envigado_com: la pagina arma el documento con JS (jQuery +
        # ~5 llamadas AJAX). Sin renderizado el HTML crudo llega vacio.
        render_js=True,
        # #area envuelve el documento ya armado (titulo, secciones, tablas);
        # afuera solo hay chrome de la app (menu jqGrid, botones de vista).
        content_selectors=("#area",),
        # El <title>/h2 de la SPA es generico ("Visualizacion Documento") e
        # igual en todos los documentos; el nombre real esta en esta celda y
        # el codigo (ej. "GT-P-004") en la celda vecina "Codigo: ...".
        title_selectors=(".sbigf",),
        title_code_selector="td:has(.resalt)",
        # Verificado en vivo: hay documentos Derogados citados por GT-P
        # vigentes (MG-P-003 y MG-F-002 en GT-P-004, captura del 2026-10-07).
        # Un documento no "Vigente" no se guarda ni se siguen sus enlaces, y
        # queda en el informe de corrida como estado_detectado="derogado"
        # (RF-C3-IV-03): antes se descartaba sin dejar rastro.
        require_selector_text=".estado",
        require_text_values=("Vigente",),
    ),
    "observatorio_geotrends": SourceDefinition(
        name="observatorio_geotrends",
        start_urls=("https://observatorioenvigado.geotrends.co/observatorio",),
        allowed_domains=("observatorioenvigado.geotrends.co",),
        mode="general_observatory",
        delay=SOURCE_DELAYS["observatorio_geotrends"],
        # Verificado en la captura del 2026-10-07: visor de mapas (MapLibre)
        # que pinta el contenido con JS y nunca deja la red inactiva.
        render_js=True,
        render_wait="load",
        render_espera_ms=8_000,
    ),
}


def get_source(name: str) -> SourceDefinition:
    try:
        return SOURCES[name]
    except KeyError as error:
        valid = ", ".join(sorted(SOURCES))
        raise ValueError(f"Fuente desconocida: {name!r}. Validas: {valid}") from error
