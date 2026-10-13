"""Definiciones de fuente RETIRADAS de la base de conocimiento (research R16).

Concejo, MinAmbiente y MinAgricultura salieron del alcance de RF-C3-IV-01, así
que ya no están en `scraper.sources.SOURCES` y el crawler no puede activarlas.
Sus definiciones se conservan aquí, solo para las pruebas que ejercitan lógica
GENÉRICA del crawler y de `scraper.relevance` (modo normativo con rutas
permitidas, modo normativo selectivo, selectores de contenido, dominios de
descarga externos) con una configuración realista.
"""

from __future__ import annotations

from scraper.sources import SourceDefinition

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


RETIRADAS: dict[str, SourceDefinition] = {
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
        delay=0.7,
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
        delay=1.0,
        min_relevance_score=4,
        high_priority_keywords=MINAMBIENTE_HIGH_PRIORITY,
        blacklist_keywords=MINAMBIENTE_BLACKLIST,
        allowed_document_types=("decreto", "resolucion", "ley", "circular"),
        document_exclude_phrases=(
            "proyecto", "borrador", "anexo", "memoria justificativa",
            "comentarios", "observaciones", "agenda regulatoria",
        ),
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
        delay=1.0,
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
    ),
}
