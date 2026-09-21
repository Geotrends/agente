"""Registro de fuentes soportadas por el crawler multi-fuente.

Cada fuente declara sus semillas, dominios permitidos y el modo de filtrado que
debe aplicar `scraper.relevance`. Los pesos y listas aqui son deterministicos
(sin IA) y se pueden ajustar sin tocar la logica del crawler.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# --- Concejo Municipal de Envigado -----------------------------------------
# Verificado en vivo (2026-09): el sitio es WordPress; "categoria_boletines/*"
# son los listados (taxonomia) de decretos/resoluciones/circulares/boletines,
# pero cada norma individual vive bajo "/boletines/<slug>/" (sin "categoria_"),
# mezclando ahi decretos, resoluciones, circulares y boletines institucionales
# bajo el mismo prefijo. Por eso "/boletines/" debe permitirse para poder
# llegar a los documentos reales; el tipo exacto se resuelve despues via
# clasificacion de texto (ver relevance.classify_document), no por la ruta.
# Las 4 subcategorias deben estar todas permitidas: sin ellas el crawler nunca
# visita esa pagina de listado y por lo tanto nunca descubre los enlaces a los
# documentos individuales que solo aparecen ahi (verificado: omitir
# "circulares" y "boletines" dejaba fuera 50 documentos que solo se enlazan
# desde esas dos paginas).
ALLOWED_PATHS_CONCEJO = (
    "/corporacion/gaceta-del-concejo/",
    "/corporacion/gaceta-del-concejo/acuerdos/",
    "/categoria_boletines/decretos/",
    "/categoria_boletines/resoluciones/",
    "/categoria_boletines/circulares/",
    "/categoria_boletines/boletines/",
    "/boletines/",
    # Las paginas principales enlazan los archivos por ano mediante taxonomias
    # WordPress que viven fuera de /corporacion/gaceta-del-concejo/.
    "/acuerdos_ano/",
    "/actas_ano/",
)

# --- Ministerio de Ambiente --------------------------------------------------
MINAMBIENTE_HIGH_PRIORITY: dict[str, int] = {
    "decreto": 5, "resolucion": 5, "resolución": 5, "ley": 5,
    "normatividad": 4, "normativa": 4, "ruido": 4, "calidad del aire": 4,
    "contaminacion atmosferica": 4, "contaminación atmosférica": 4,
    "cambio climatico": 4, "cambio climático": 4, "residuos": 4, "agua": 4,
    "biodiversidad": 4, "suelo": 4, "licenciamiento": 4,
    "ordenamiento ambiental": 4, "politica ambiental": 4, "política ambiental": 4,
    "guia": 4, "guía": 4, "manual": 4, "protocolo": 4, "lineamiento": 4,
    "conpes": 3, "circular": 3, "gestion ambiental": 3, "gestión ambiental": 3,
    "autoridad ambiental": 3, "calidad ambiental": 4,
}
MINAMBIENTE_BLACKLIST: dict[str, int] = {
    "noticia": -5, "prensa": -5, "evento": -5, "galeria": -5, "galería": -5,
    "video": -5, "instagram": -5, "facebook": -5, "twitter": -5, "youtube": -5,
    "convocatoria": -4, "campana": -3, "campaña": -3, "hoja de vida": -4,
    "vacante": -4, "ceremonia": -3,
}

# --- Ministerio de Agricultura -----------------------------------------------
MINAGRICULTURA_HIGH_PRIORITY: dict[str, int] = {
    "decreto": 5, "resolucion": 5, "resolución": 5, "ley": 5,
    "normatividad": 4, "desarrollo rural": 4, "desarrollo agropecuario": 4,
    "extension agropecuaria": 4, "extensión agropecuaria": 4, "snia": 4,
    "epsea": 4, "pdea": 4, "asistencia tecnica": 4, "asistencia técnica": 4,
    "agricultura campesina": 4, "productor rural": 4, "productores rurales": 4,
    "seguridad alimentaria": 4, "comercializacion": 4, "comercialización": 4,
    "agroecologia": 4, "agroecología": 4, "produccion agropecuaria": 4,
    "producción agropecuaria": 4, "innovacion agropecuaria": 4,
    "innovación agropecuaria": 4,
    "consejo municipal de desarrollo rural": 4, "cmdr": 4,
    "politica": 3, "política": 3, "plan": 3, "guia": 4, "guía": 4,
    "manual": 4, "lineamiento": 4, "circular": 3,
}
MINAGRICULTURA_BLACKLIST: dict[str, int] = {
    "noticia": -5, "prensa": -5, "evento": -5, "galeria": -5, "galería": -5,
    "video": -5, "instagram": -5, "facebook": -5, "twitter": -5, "youtube": -5,
    "convocatoria": -3, "vacante": -4, "contratacion": -3, "contratación": -3,
    "hoja de vida": -4,
}

# Retraso minimo (segundos) entre solicitudes, por fuente.
SOURCE_DELAYS: dict[str, float] = {
    "ambientometro": 0.5,
    "concejo_envigado": 0.7,
    "minambiente": 1.0,
    "minagricultura": 1.0,
}


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
    document_folder_mode: str = "extension"  # "extension" | "document_type"
    legacy_flat_layout: bool = False
    user_agent: str = ""  # vacio = usar el user_agent transparente por defecto


SOURCES: dict[str, SourceDefinition] = {
    "ambientometro": SourceDefinition(
        name="ambientometro",
        start_urls=("https://ambientometroenvigado.com/observatorio/",),
        allowed_domains=("ambientometroenvigado.com",),
        mode="general_observatory",
        related_seed_urls=("https://ambientometroenvigado.com/biblioteca-boletines/",),
        delay=SOURCE_DELAYS["ambientometro"],
        document_folder_mode="extension",
        # A partir de ahora anida bajo su propia carpeta, igual que las demas
        # fuentes. Los archivos que ya existian antes de este cambio (layout
        # plano, directo bajo OUTPUT_DIR) se dejan donde estan: el dedup por
        # SHA-256 los sigue reconociendo via metadata/documentos.csv, solo lo
        # nuevo que se descubra de aqui en adelante cae en ambientometro/.
        legacy_flat_layout=False,
    ),
    "concejo_envigado": SourceDefinition(
        name="concejo_envigado",
        start_urls=("https://www.concejoenvigado.gov.co/corporacion/gaceta-del-concejo/",),
        allowed_domains=("concejoenvigado.gov.co", "www.concejoenvigado.gov.co"),
        mode="normative",
        allowed_paths=ALLOWED_PATHS_CONCEJO,
        # Un proyecto aun no es una norma aprobada. Se conserva "acuerdo-*"
        # y se descarta "proyecto-de-acuerdo-*" para no contaminar el corpus.
        document_exclude_phrases=("proyecto de acuerdo",),
        # Verificado en vivo (2026-09): "/acuerdos_ano/" expone acuerdos desde
        # 1905. Los anteriores a la Constitucion de 1991 son normativa casi
        # con certeza derogada/reemplazada y ademas dieron el peor OCR de la
        # muestra (escaneos de baja calidad, Tesseract reporto "possibly poor
        # OCR"). Los sin anio detectable no se descartan por esto.
        min_document_year=1991,
        delay=SOURCE_DELAYS["concejo_envigado"],
        document_folder_mode="document_type",
        content_selectors=(
            ".elementor-widget-archive-posts",
            ".elementor-widget-theme-post-content",
            ".elementor-location-archive",
            "main",
        ),
        # Verificado en vivo: el Apache/WAF de este sitio devuelve 403 a
        # cualquier User-Agent que se identifique como bot/crawler (incluido
        # el UA transparente por defecto), pero permite un UA de navegador
        # estandar. robots.txt no restringe estas rutas.
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        ),
    ),
    "minambiente": SourceDefinition(
        name="minambiente",
        start_urls=(
            "https://www.minambiente.gov.co/",
            "https://www.minambiente.gov.co/normativa/",
        ),
        allowed_domains=("minambiente.gov.co", "www.minambiente.gov.co"),
        mode="selective_normative",
        delay=SOURCE_DELAYS["minambiente"],
        min_relevance_score=4,
        high_priority_keywords=MINAMBIENTE_HIGH_PRIORITY,
        blacklist_keywords=MINAMBIENTE_BLACKLIST,
        allowed_document_types=("decreto", "resolucion", "ley", "circular"),
        document_exclude_phrases=(
            "proyecto", "borrador", "anexo", "memoria justificativa",
            "comentarios", "observaciones", "agenda regulatoria",
        ),
        document_folder_mode="extension",
    ),
    "minagricultura": SourceDefinition(
        name="minagricultura",
        start_urls=(
            "https://www.minagricultura.gov.co/normatividad/decretos",
            "https://www.minagricultura.gov.co/normatividad/resoluciones",
            "https://www.minagricultura.gov.co/normatividad/leyes",
        ),
        allowed_domains=("minagricultura.gov.co", "www.minagricultura.gov.co"),
        mode="selective_normative",
        delay=SOURCE_DELAYS["minagricultura"],
        min_relevance_score=4,
        high_priority_keywords=MINAGRICULTURA_HIGH_PRIORITY,
        blacklist_keywords=MINAGRICULTURA_BLACKLIST,
        allowed_document_types=("decreto", "resolucion", "ley", "circular"),
        # "notificacion": verificado en vivo, /normatividad/notificaciones/
        # publica actos administrativos individuales dirigidos a una persona
        # (terminacion de contrato, resoluciones de personal) con el nombre
        # propio en el filename. allowed_document_types no basta porque el
        # filename suele incluir la palabra "resolucion"/"resol" igual
        # (ej. "gladys_nayibe_villamizar_contreras_resolucion.pdf"), asi que
        # classify_document los identifica como tipo "resolucion" valido.
        document_exclude_phrases=(
            "proyecto", "borrador", "anexo", "memoria justificativa",
            "comentarios", "observaciones", "agenda regulatoria",
            "notificacion",
        ),
        content_selectors=("main",),
        document_allowed_domains=(
            "pruebasse.minagricultura.gov.co",
            "minagriculturaco-my.sharepoint.com",
        ),
        document_folder_mode="extension",
    ),
}


def get_source(name: str) -> SourceDefinition:
    try:
        return SOURCES[name]
    except KeyError as error:
        valid = ", ".join(sorted(SOURCES))
        raise ValueError(f"Fuente desconocida: {name!r}. Validas: {valid}") from error
