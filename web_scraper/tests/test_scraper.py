from __future__ import annotations

import csv
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

from requests.structures import CaseInsensitiveDict

from scraper.config import ScraperConfig
from scraper.crawler import CrawlItem, SourceCrawler
from scraper.downloader import CATEGORY_BY_EXTENSION, document_extension, response_filename
from scraper.downloader import DocumentDownloader
from scraper.html_parser import ParsedPage, markdown_document, parse_html
from scraper.metadata_store import MetadataStore
from scraper.relevance import (
    classify_document,
    relevance_score, should_crawl_url, should_download_document,
)
from scraper.sources import SOURCES
from scraper.utils import looks_like_document_url, normalize_url, safe_destination, should_ignore_url, slugify
from main import print_report
from scripts.recover_page_metadata import parse_frontmatter, recover

# Fuentes retiradas del alcance (RF-C3-IV-01): sus definiciones viven en un
# módulo de pruebas porque estas pruebas cubren lógica genérica del crawler.
from fuentes_retiradas import RETIRADAS

CONCEJO_PRUEBA = RETIRADAS["concejo_envigado"]
MINAGRI_PRUEBA = RETIRADAS["minagricultura"]


class UrlTests(unittest.TestCase):
    def test_normalizes_fragments_host_and_tracking(self) -> None:
        value = normalize_url(
            "/observatorio/pagina?utm_source=x&b=2&a=1#contenido",
            "https://www.ambientometroenvigado.com/observatorio/",
        )
        self.assertEqual(
            value,
            "https://ambientometroenvigado.com/observatorio/pagina/?a=1&b=2",
        )

    def test_http_and_https_are_canonicalized(self) -> None:
        self.assertEqual(
            normalize_url("http://www.ambientometroenvigado.com/observatorio"),
            "https://ambientometroenvigado.com/observatorio/",
        )

    def test_slug_is_safe_and_unicode_aware(self) -> None:
        self.assertEqual(slugify("Informe Calidad del Aire 2024.pdf"), "informe_calidad_del_aire_2024.pdf")

    def test_path_traversal_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            with self.assertRaises(ValueError):
                safe_destination(root, Path("../escape.txt"))

    def test_decorative_assets_are_not_crawled(self) -> None:
        # gif, svg y webp son decoración; png/jpg/tif enlazados son escaneos (RF-C3-IV-08).
        self.assertTrue(should_ignore_url("https://ambientometroenvigado.com/uploads/banner.gif"))
        self.assertTrue(should_ignore_url("https://ambientometroenvigado.com/uploads/logo.svg"))
        self.assertFalse(should_ignore_url("https://ambientometroenvigado.com/uploads/escaneo.JPG"))
        self.assertFalse(should_ignore_url("https://ambientometroenvigado.com/uploads/informe.pdf"))


class ParserTests(unittest.TestCase):
    def test_extracts_main_without_navigation_and_converts_table(self) -> None:
        html = """
        <html><head><title>Prueba | Ambientómetro</title></head><body>
        <nav><a href='/irrelevante/'>Menu repetido</a></nav>
        <article><div class='entry-content'>
          <h1>Calidad del aire</h1><p>Contenido realmente util para ciudadanos.</p>
          <table><tr><th>Variable</th><th>Valor</th></tr><tr><td>PM2.5</td><td>15</td></tr></table>
          <a href='/docs/informe.pdf'>Descargar informe</a>
        </div></article><footer>Pie repetido</footer></body></html>
        """
        page = parse_html(html, "https://ambientometroenvigado.com/observatorio/aire/")
        self.assertEqual(page.title, "Calidad del aire")
        self.assertIn("| Variable | Valor |", page.markdown)
        self.assertNotIn("Menu repetido", page.markdown)
        self.assertEqual(len(page.links), 1)
        self.assertEqual(page.category, "aire")

    def test_image_is_a_document_only_when_linked_explicitly(self) -> None:
        # RF-C3-IV-08: un escaneo enlazado con <a href> se adquiere para OCR;
        # las <img> decorativas de la página nunca.
        html = """
        <html><body><article><div class='entry-content'>
          <h1>Boletín escaneado</h1>
          <img src="/wp-content/uploads/banner.png" alt="Banner">
          <a href="/wp-content/uploads/boletin-abril.jpg">Descargar boletín</a>
          <a href="/wp-content/uploads/mapa.tiff">Mapa</a>
        </div></article></body></html>
        """
        page = parse_html(html, "https://ambientometroenvigado.com/boletines/")
        urls = [url for url, _ in page.links]
        self.assertEqual(sorted(urls), [
            "https://ambientometroenvigado.com/wp-content/uploads/boletin-abril.jpg",
            "https://ambientometroenvigado.com/wp-content/uploads/mapa.tiff",
        ])
        self.assertTrue(all(looks_like_document_url(u) for u in urls))
        self.assertEqual(CATEGORY_BY_EXTENSION[".jpg"], "imagen")

    def test_extracts_document_embedded_via_embed_tag(self) -> None:
        # El Concejo de Envigado inserta el PDF de cada norma con <embed>, no <a href>.
        html = """
        <html><body><article><div class='entry-content'>
          <h1>Decreto Nro. 123 de 2026</h1>
          <div class="elementor-shortcode">
            <embed src="/wp-content/uploads/2026/05/Decreto-123.pdf" type="application/pdf" width="100%" height="600px" />
          </div>
        </div></article></body></html>
        """
        page = parse_html(html, "https://www.concejoenvigado.gov.co/boletines/decreto-123-de-2026/")
        self.assertEqual(len(page.links), 1)
        url, text = page.links[0]
        # parse_html usa normalize_url tal cual (sin "www."); el crawler la
        # reintegra despues via utils.rehost segun la fuente configurada.
        self.assertEqual(url, "https://concejoenvigado.gov.co/wp-content/uploads/2026/05/Decreto-123.pdf")
        self.assertEqual(text, "Decreto Nro. 123 de 2026")

    def test_removes_site_suffix_from_title(self) -> None:
        page = parse_html(
            "<main><h1>Ruido</h1><p>" + "contenido " * 20 + "</p></main>"
            "<title>Ruido - GEOPORTAL AMBIENTAL Envigado</title>",
            "https://ambientometroenvigado.com/ruido/",
        )
        self.assertEqual(page.title, "Ruido")

    def test_frontmatter_has_source(self) -> None:
        page = parse_html("<main><h1>Titulo</h1><p>" + "texto " * 30 + "</p></main>", "https://example.com/x")
        rendered = markdown_document(page, "https://example.com/x", __import__("datetime").datetime.now().astimezone())
        self.assertTrue(rendered.startswith("---\ntitle:"))
        self.assertIn('source_url: "https://example.com/x"', rendered)

    def test_concejo_archive_selector_extracts_all_cards(self) -> None:
        html = """
        <body>
          <article><a href='/boletines/solo-el-primero/'>Primero</a></article>
          <section class='elementor-widget-archive-posts'>
            <article><a href='/boletines/decreto-1/'>Decreto 1</a></article>
            <article><a href='/boletines/decreto-2/'>Decreto 2</a></article>
          </section>
        </body>
        """
        page = parse_html(
            html, "https://www.concejoenvigado.gov.co/categoria_boletines/decretos/",
            CONCEJO_PRUEBA.content_selectors,
        )
        self.assertEqual([text for _, text in page.links], ["Decreto 1", "Decreto 2"])

    def test_minagricultura_selector_uses_full_main_not_first_article(self) -> None:
        html = """
        <main>
          <article><a href='/docs/resolucion-1.pdf'>Resolucion 1</a></article>
          <article><a href='/docs/resolucion-2.pdf'>Resolucion 2</a></article>
        </main>
        """
        page = parse_html(
            html, "https://www.minagricultura.gov.co/normatividad/resoluciones/",
            MINAGRI_PRUEBA.content_selectors,
        )
        self.assertEqual(len(page.links), 2)


class MimeTests(unittest.TestCase):
    def test_mime_detects_extensionless_pdf(self) -> None:
        headers = CaseInsensitiveDict({"Content-Type": "application/pdf"})
        self.assertEqual(document_extension("https://example.com/download?id=1", headers), ".pdf")

    def test_disposition_has_priority(self) -> None:
        headers = CaseInsensitiveDict({
            "Content-Type": "application/octet-stream",
            "Content-Disposition": "attachment; filename*=UTF-8''Informe%202024.xlsx",
        })
        self.assertEqual(document_extension("https://example.com/file/1", headers), ".xlsx")

    def test_response_filename_prefers_content_disposition(self) -> None:
        headers = CaseInsensitiveDict({
            "Content-Disposition": "attachment; filename*=UTF-8''Resolucion%20042%20de%202026.pdf",
        })
        self.assertEqual(
            response_filename("https://example.com/download?id=1", headers),
            "Resolucion 042 de 2026.pdf",
        )

    def test_rejects_html_disguised_as_pdf(self) -> None:
        with tempfile.NamedTemporaryFile() as stream:
            stream.write(b"<html>error</html>")
            stream.flush()
            with self.assertRaisesRegex(ValueError, "HTML"):
                DocumentDownloader._validate_file(Path(stream.name), ".pdf")

    def test_accepts_valid_xlsx_container(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".xlsx") as stream:
            with zipfile.ZipFile(stream.name, "w") as archive:
                archive.writestr("[Content_Types].xml", "<Types/>")
            DocumentDownloader._validate_file(Path(stream.name), ".xlsx")


class ConfigTests(unittest.TestCase):
    def test_creates_output_tree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = ScraperConfig(output_dir=Path(directory) / "corpus")
            config.create_directories()
            self.assertTrue((config.output_dir / "metadata").is_dir())
            self.assertTrue((config.output_dir / "documentos/pdf").is_dir())

    def test_ambientometro_source_nests_under_its_own_folder(self) -> None:
        # Preferencia del usuario: todas las fuentes, incluida ambientometro,
        # quedan separadas bajo su propia carpeta (las corridas previas al
        # cambio se dejan donde estaban; ver README).
        self.assertFalse(SOURCES["ambientometro"].legacy_flat_layout)

    def test_new_sources_nest_content_under_their_own_folder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = ScraperConfig(
                start_url="https://www.concejoenvigado.gov.co/corporacion/gaceta-del-concejo/",
                output_dir=Path(directory) / "corpus", source_name="concejo_envigado",
                legacy_flat_layout=False,
            )
            config.create_directories()
            self.assertEqual(config.content_dir, config.output_dir / "concejo_envigado")
            self.assertTrue((config.output_dir / "concejo_envigado/documentos/pdf").is_dir())
            # metadata/logs siguen compartidos en la raiz para todas las fuentes.
            self.assertTrue((config.output_dir / "metadata").is_dir())
            self.assertFalse((config.output_dir / "documentos").exists())

    def test_external_document_domains_are_not_crawl_domains(self) -> None:
        source = MINAGRI_PRUEBA
        with tempfile.TemporaryDirectory() as directory:
            config = ScraperConfig(
                start_url=source.start_urls[0], output_dir=Path(directory),
                source_name=source.name, extra_allowed_domains=source.allowed_domains,
                document_allowed_domains=source.document_allowed_domains,
            )
            sharepoint = "minagriculturaco-my.sharepoint.com"
            self.assertIn(sharepoint, config.document_allowed_hosts)
            self.assertNotIn(sharepoint, config.allowed_hosts)

    def test_external_document_link_is_enqueued_but_not_crawled_as_page(self) -> None:
        # Un host de solo descargas se encola como documento pero nunca se
        # navega como pagina. Desde el bloque 1 ademas debe estar en la lista
        # cerrada de hosts (test_sources_scope.py cubre el caso contrario).
        with tempfile.TemporaryDirectory() as directory:
            config = ScraperConfig(
                start_url="https://ambientometroenvigado.com/observatorio/", output_dir=Path(directory),
                source_name="ambientometro", document_allowed_domains=("gmas2.envigado.gov.co",),
            )
            crawler = SourceCrawler(config)
            item = CrawlItem(config.start_url, 0, "")
            children = crawler._build_children(
                item, config.start_url, "Observatorio",
                [("https://gmas2.envigado.gov.co/gmas/downloadFile.public?repositorioArchivo=1", "Formato")],
            )
            self.assertEqual(len(children), 1)
            self.assertTrue(children[0].document_hint)
            self.assertTrue(crawler._allowed(children[0]))
            self.assertFalse(crawler._allowed(CrawlItem(children[0].url, 1, config.start_url)))


class RelevanceTests(unittest.TestCase):
    def test_positive_and_negative_terms_are_scored(self) -> None:
        score, matched = relevance_score(url="/categoria_boletines/decretos/decreto-008-de-2020")
        self.assertGreaterEqual(score, 5)
        self.assertIn("+5:decreto", matched)

        score, _ = relevance_score(title="Evento de lanzamiento de campaña", url="/noticias/evento/")
        self.assertLess(score, 0)

    def test_classify_document_extracts_tipo_numero_anio(self) -> None:
        self.assertEqual(
            classify_document("Acuerdo No. 008 de 2017"),
            classify_document("Acuerdo No. 008 de 2017"),
        )
        result = classify_document("Acuerdo No. 008 de 2017")
        self.assertEqual((result.document_type, result.document_number, result.year), ("acuerdo", "8", "2017"))

    def test_classify_document_handles_underscore_filenames_with_full_date(self) -> None:
        result = classify_document("DECRETO_No._0765_DEL_15_DE_JULIO_DE_2026.pdf")
        self.assertEqual((result.document_type, result.document_number, result.year), ("decreto", "765", "2026"))

    def test_classify_document_handles_numbered_normative_abbreviations(self) -> None:
        cases = {
            "res.-1183-de-08-sep-2026.pdf": ("resolucion", "1183", "2026"),
            "DEC-042-DE-2025.pdf": ("decreto", "42", "2025"),
            "CIR. 007 DE 2024.pdf": ("circular", "7", "2024"),
        }
        for filename, expected in cases.items():
            result = classify_document(filename)
            self.assertEqual(
                (result.document_type, result.document_number, result.year), expected,
            )

    def test_classify_document_matches_singular_irregular_plurals(self) -> None:
        self.assertEqual(classify_document("Manual de buenas practicas").document_type, "manual")
        self.assertEqual(classify_document("Plan de desarrollo").document_type, "plan")
        self.assertEqual(classify_document("Ley general ambiental").document_type, "ley")

    def test_classify_document_does_not_invent_type(self) -> None:
        result = classify_document("Contenido sin tipo normativo reconocible")
        self.assertEqual((result.document_type, result.document_number, result.year), ("", "", ""))

    def test_should_crawl_url_normative_mode_restricted_to_allowed_paths(self) -> None:
        concejo = CONCEJO_PRUEBA
        allowed, reason, _ = should_crawl_url(
            url="https://www.concejoenvigado.gov.co/categoria_boletines/decretos/decreto-1/",
            depth=1, mode=concejo.mode, allowed_paths=concejo.allowed_paths,
        )
        self.assertTrue(allowed)
        blocked, reason, _ = should_crawl_url(
            url="https://www.concejoenvigado.gov.co/pqrsd/", depth=1,
            mode=concejo.mode, allowed_paths=concejo.allowed_paths,
        )
        self.assertFalse(blocked)

    def test_should_crawl_url_allows_all_concejo_listing_categories(self) -> None:
        # Verificado en vivo (2026-09): estos 4 listados de "categoria_boletines"
        # son la unica forma de descubrir cada tipo de documento; si alguno
        # falta en ALLOWED_PATHS_CONCEJO sus documentos nunca se encuentran
        # (bug detectado: "circulares" y "boletines" institucionales faltaban).
        concejo = CONCEJO_PRUEBA
        for category in ("decretos", "resoluciones", "circulares", "boletines"):
            allowed, _, _ = should_crawl_url(
                url=f"https://www.concejoenvigado.gov.co/categoria_boletines/{category}/",
                depth=1, mode=concejo.mode, allowed_paths=concejo.allowed_paths,
            )
            self.assertTrue(allowed, f"categoria_boletines/{category}/ deberia estar permitida")

    def test_should_crawl_url_allows_concejo_year_taxonomies(self) -> None:
        concejo = CONCEJO_PRUEBA
        for path in ("acuerdos_ano", "actas_ano"):
            allowed, _, _ = should_crawl_url(
                url=f"https://www.concejoenvigado.gov.co/{path}/2026/",
                depth=2, mode=concejo.mode, allowed_paths=concejo.allowed_paths,
            )
            self.assertTrue(allowed, f"/{path}/ deberia estar permitida")

        allowed, reason, _ = should_crawl_url(
            url="https://www.concejoenvigado.gov.co/proyectos_de_acuerdos_ano/2026/",
            depth=2, mode=concejo.mode, allowed_paths=concejo.allowed_paths,
        )
        self.assertFalse(allowed)
        self.assertEqual(reason, "fuera_de_allowed_paths")

    def test_should_crawl_url_selective_normative_allows_index_pages_despite_low_score(self) -> None:
        minambiente = RETIRADAS["minambiente"]
        # Score bajo (sin coincidencias) pero profundidad<=1: se admite igual como
        # pagina de indice necesaria para descubrir contenido normativo (seccion 5).
        allowed, reason, score = should_crawl_url(
            url="https://www.minambiente.gov.co/ministerio/organigrama/", depth=1,
            mode=minambiente.mode, min_score=minambiente.min_relevance_score,
            high_priority=minambiente.high_priority_keywords,
            blacklist=minambiente.blacklist_keywords,
        )
        self.assertTrue(allowed)
        self.assertIn("indice", reason)
        self.assertLess(score, minambiente.min_relevance_score)

    def test_should_crawl_url_selective_normative_rejects_irrelevant_deep_pages(self) -> None:
        minambiente = RETIRADAS["minambiente"]
        allowed, _, score = should_crawl_url(
            url="https://www.minambiente.gov.co/sala-de-prensa/noticias/alguna-noticia/",
            anchor_text="Alguna noticia", depth=3, mode=minambiente.mode,
            min_score=minambiente.min_relevance_score, high_priority=minambiente.high_priority_keywords,
            blacklist=minambiente.blacklist_keywords,
        )
        self.assertFalse(allowed)
        self.assertLess(score, minambiente.min_relevance_score)

    def test_should_download_document_rejects_disallowed_extension(self) -> None:
        allowed, reason, _ = should_download_document(
            url="https://example.com/banner.gif", filename="banner.gif", extension=".gif",
            mode="general_observatory",
        )
        self.assertFalse(allowed)
        self.assertEqual(reason, "extension_no_permitida")

    def test_should_download_document_rejects_zip_extension(self) -> None:
        minagricultura = MINAGRI_PRUEBA
        allowed, reason, _ = should_download_document(
            url="https://www.minagricultura.gov.co/normatividad/decreto-anexos.zip",
            filename="decreto-anexos.zip", anchor_text="Anexos del decreto 123 de 2020",
            extension=".zip", mode=minagricultura.mode,
            min_score=minagricultura.min_relevance_score,
            high_priority=minagricultura.high_priority_keywords,
            blacklist=minagricultura.blacklist_keywords,
        )
        self.assertFalse(allowed)
        self.assertEqual(reason, "extension_no_permitida")

    def test_should_download_document_normative_mode_is_exhaustive(self) -> None:
        concejo = CONCEJO_PRUEBA
        allowed, reason, _ = should_download_document(
            url="https://www.concejoenvigado.gov.co/corporacion/gaceta-del-concejo/acuerdos/acuerdo-1.pdf",
            filename="acuerdo-1.pdf", extension=".pdf", mode=concejo.mode,
        )
        self.assertTrue(allowed)
        self.assertIn("exhaustiva", reason)

    def test_concejo_rejects_projects_but_keeps_approved_agreements(self) -> None:
        concejo = CONCEJO_PRUEBA
        project_allowed, reason, _ = should_download_document(
            url="https://www.concejoenvigado.gov.co/docs/proyecto-de-acuerdo-036-de-2026.pdf",
            filename="proyecto-de-acuerdo-036-de-2026.pdf", extension=".pdf",
            mode=concejo.mode, exclude_phrases=concejo.document_exclude_phrases,
        )
        self.assertFalse(project_allowed)
        self.assertEqual(reason, "frase_excluida:proyecto de acuerdo")

        agreement_allowed, reason, _ = should_download_document(
            url="https://www.concejoenvigado.gov.co/docs/acuerdo-036-de-2026.pdf",
            filename="acuerdo-036-de-2026.pdf", extension=".pdf",
            mode=concejo.mode, exclude_phrases=concejo.document_exclude_phrases,
        )
        self.assertTrue(agreement_allowed)
        self.assertIn("exhaustiva", reason)

    def test_concejo_rejects_agreements_before_1991_but_keeps_recent_ones(self) -> None:
        # Verificado en vivo: "/acuerdos_ano/" expone acuerdos desde 1905. Los
        # anteriores a la Constitucion de 1991 son casi con certeza normativa
        # derogada y dieron el peor OCR de la muestra (escaneos centenarios).
        concejo = CONCEJO_PRUEBA
        self.assertEqual(concejo.min_document_year, 1991)

        old_allowed, reason, _ = should_download_document(
            url="https://www.concejoenvigado.gov.co/boletines/acuerdo-112-de-1905/",
            filename="acuerdo-112-de-1905.pdf", extension=".pdf",
            mode=concejo.mode, exclude_phrases=concejo.document_exclude_phrases,
            min_year=concejo.min_document_year,
        )
        self.assertFalse(old_allowed)
        self.assertEqual(reason, "anterior_a_1991:1905")

        recent_allowed, reason, _ = should_download_document(
            url="https://www.concejoenvigado.gov.co/boletines/acuerdo-009-de-2001/",
            filename="acuerdo-009-de-2001.pdf", extension=".pdf",
            mode=concejo.mode, exclude_phrases=concejo.document_exclude_phrases,
            min_year=concejo.min_document_year,
        )
        self.assertTrue(recent_allowed, reason)

        # Sin anio detectable en url/filename: no se descarta por esto (evita
        # falsos positivos sobre documentos sin fecha identificable).
        undated_allowed, reason, _ = should_download_document(
            url="https://www.concejoenvigado.gov.co/boletines/acuerdo-vigencia/",
            filename="acuerdo-vigencia.pdf", extension=".pdf",
            mode=concejo.mode, exclude_phrases=concejo.document_exclude_phrases,
            min_year=concejo.min_document_year,
        )
        self.assertTrue(undated_allowed, reason)

    def test_minagricultura_rejects_personnel_notifications(self) -> None:
        # Verificado en vivo: /normatividad/notificaciones/ publica actos
        # administrativos individuales (terminacion de contrato, resoluciones
        # de personal) con el nombre de la persona en el filename. El
        # whitelist de allowed_document_types no basta porque estos filenames
        # suelen incluir la palabra "resolucion"/"resol", asi que
        # classify_document los identifica como tipo "resolucion" valido.
        minagricultura = MINAGRI_PRUEBA
        self.assertIn("notificacion", minagricultura.document_exclude_phrases)

        for filename in (
            "gladys_nayibe_villamizar_contreras_resolucion.pdf",
            "zeyda_usquiano_quintero_resol.pdf",
        ):
            allowed, reason, _ = should_download_document(
                url=f"https://www.minagricultura.gov.co/normatividad/notificaciones/{filename}",
                filename=filename, extension=".pdf", mode=minagricultura.mode,
                min_score=minagricultura.min_relevance_score,
                high_priority=minagricultura.high_priority_keywords,
                blacklist=minagricultura.blacklist_keywords,
                exclude_phrases=minagricultura.document_exclude_phrases,
                allowed_document_types=minagricultura.allowed_document_types,
            )
            self.assertFalse(allowed, f"No deberia aceptar {filename}: {reason}")

        # Una resolucion normativa real, fuera de /notificaciones/, se conserva.
        real_allowed, reason, _ = should_download_document(
            url="https://www.minagricultura.gov.co/normatividad/resoluciones/resolucion-211-de-2014.pdf",
            filename="resolucion-211-de-2014.pdf", extension=".pdf", mode=minagricultura.mode,
            min_score=minagricultura.min_relevance_score,
            high_priority=minagricultura.high_priority_keywords,
            blacklist=minagricultura.blacklist_keywords,
            exclude_phrases=minagricultura.document_exclude_phrases,
            allowed_document_types=minagricultura.allowed_document_types,
        )
        self.assertTrue(real_allowed, reason)

    def test_ministries_only_allow_four_normative_document_types(self) -> None:
        expected_types = ("decreto", "resolucion", "ley", "circular")
        for source_name in ("minambiente", "minagricultura"):
            source = RETIRADAS[source_name]
            self.assertEqual(source.allowed_document_types, expected_types)
            for document_type in expected_types:
                allowed, reason, _ = should_download_document(
                    url=f"https://example.gov.co/{document_type}-001-de-2026.pdf",
                    filename=f"{document_type}-001-de-2026.pdf", extension=".pdf",
                    mode=source.mode, min_score=source.min_relevance_score,
                    high_priority=source.high_priority_keywords,
                    blacklist=source.blacklist_keywords,
                    exclude_phrases=source.document_exclude_phrases,
                    allowed_document_types=source.allowed_document_types,
                )
                self.assertTrue(allowed, f"{source_name} deberia aceptar {document_type}: {reason}")

            abbreviated_allowed, reason, _ = should_download_document(
                url="https://example.gov.co/res.-1183-de-08-sep-2026.pdf",
                filename="res.-1183-de-08-sep-2026.pdf", extension=".pdf",
                mode=source.mode, min_score=source.min_relevance_score,
                high_priority=source.high_priority_keywords,
                blacklist=source.blacklist_keywords,
                exclude_phrases=source.document_exclude_phrases,
                allowed_document_types=source.allowed_document_types,
            )
            self.assertTrue(abbreviated_allowed, reason)

    def test_ministries_reject_non_normative_and_draft_documents(self) -> None:
        source = RETIRADAS["minambiente"]
        rejected_names = (
            "proyecto-de-decreto-123-de-2026.pdf",
            "borrador-resolucion-045-de-2026.pdf",
            "anexo-ley-99-de-1993.pdf",
            "manual-de-gestion-ambiental.pdf",
            "guia-de-calidad-del-aire.pdf",
            "plan-de-accion-2026.pdf",
        )
        for filename in rejected_names:
            allowed, _, _ = should_download_document(
                url=f"https://www.minambiente.gov.co/documentos/{filename}",
                filename=filename, extension=".pdf", mode=source.mode,
                min_score=source.min_relevance_score,
                high_priority=source.high_priority_keywords,
                blacklist=source.blacklist_keywords,
                exclude_phrases=source.document_exclude_phrases,
                allowed_document_types=source.allowed_document_types,
            )
            self.assertFalse(allowed, f"No deberia aceptar {filename}")

    def test_index_title_does_not_make_generic_attachment_a_resolution(self) -> None:
        source = MINAGRI_PRUEBA
        allowed, reason, _ = should_download_document(
            url="https://www.minagricultura.gov.co/documentos/archivo-123.pdf",
            filename="archivo-123.pdf", anchor_text="Descargar",
            source_page_title="Resoluciones", extension=".pdf", mode=source.mode,
            min_score=source.min_relevance_score,
            high_priority=source.high_priority_keywords,
            blacklist=source.blacklist_keywords,
            exclude_phrases=source.document_exclude_phrases,
            allowed_document_types=source.allowed_document_types,
        )
        self.assertFalse(allowed)
        self.assertEqual(reason, "tipo_documental_no_permitido:no_identificado")


class RecoverPageMetadataTests(unittest.TestCase):
    """scripts/recover_page_metadata.py: la reconstruccion del hallazgo A-7."""

    def _page(self, title: str) -> ParsedPage:
        return ParsedPage(
            title=title, markdown=f"# {title}\n\ncontenido de prueba.",
            links=[], category="generica", author="", published_date="",
            content_hash="d" * 64, dynamic_suspected=False,
        )

    def test_parse_frontmatter_round_trips_quotes_backslashes_and_unicode(self) -> None:
        # Casos deliberadamente hostiles al escape de quote() en
        # html_parser.markdown_document: comillas, barras invertidas en
        # secuencia, y texto fuera de Latin-1.
        titles = [
            'Resolución "0841" de vertimientos',
            'Ruta C:\\datos\\archivo — con barra al final\\',
            "Ñandú, acentos, emoji 😀 y griego αβγ",
            'Comillas y barra juntas: \\"literal\\"',
        ]
        for title in titles:
            page = self._page(title)
            rendered = markdown_document(page, "https://example.com/x", datetime.now(timezone.utc))
            fields = parse_frontmatter(rendered)
            self.assertEqual(fields.get("title"), title, f"no sobrevivio: {title!r}")
            self.assertEqual(fields.get("source_url"), "https://example.com/x")

    def test_parse_frontmatter_ignores_a_file_without_one(self) -> None:
        self.assertEqual(parse_frontmatter("# Solo un titulo\n\nsin frontmatter.\n"), {})

    def test_recover_adds_missing_rows_without_touching_existing_ones(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)

            # Una fuente que SI tiene su fila en paginas.csv (el caso sano).
            sano_dir = output_dir / "minagricultura" / "paginas_md" / "directorio"
            sano_dir.mkdir(parents=True)
            sano_path = sano_dir / "existente.md"
            sano_path.write_text(
                markdown_document(self._page("Ya en el catalogo"), "https://minagricultura.example/ya", datetime.now(timezone.utc)),
                encoding="utf-8",
            )

            # Dos fuentes cuyas filas se perdieron por el bug de A-7 (el caso
            # que este script existe para reparar).
            perdida_dir = output_dir / "minambiente" / "paginas_md" / "resoluciones"
            perdida_dir.mkdir(parents=True)
            for name, title in (("r1.md", "Resolucion perdida 1"), ("r2.md", "Resolucion perdida 2")):
                (perdida_dir / name).write_text(
                    markdown_document(self._page(title), f"https://minambiente.example/{name}", datetime.now(timezone.utc)),
                    encoding="utf-8",
                )

            metadata_dir = output_dir / "metadata"
            metadata_dir.mkdir(parents=True)
            with (metadata_dir / "paginas.csv").open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=[
                    "id", "title", "url", "local_md_path", "category", "depth",
                    "http_status", "content_length", "content_sha256", "scraped_at",
                    "dynamic_suspected", "source",
                ])
                writer.writeheader()
                writer.writerow({
                    "id": "page-000001", "title": "Ya en el catalogo",
                    "url": "https://minagricultura.example/ya",
                    "local_md_path": "minagricultura/paginas_md/directorio/existente.md",
                    "category": "generica", "depth": 1, "http_status": 200,
                    "content_length": 10, "content_sha256": "e" * 64,
                    "scraped_at": "2020-01-01T00:00:00", "dynamic_suspected": False,
                    "source": "minagricultura",
                })

            added, kept, unparsed = recover(output_dir)
            self.assertEqual(kept, 1, "la fila ya presente se cuenta como conservada")
            self.assertEqual(added, 2, "las dos paginas de minambiente se reconstruyen")
            self.assertEqual(unparsed, [])

            with (metadata_dir / "paginas.csv").open(encoding="utf-8-sig", newline="") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(len(rows), 3)

            existing_row = next(r for r in rows if r["local_md_path"].endswith("existente.md"))
            self.assertEqual(existing_row["url"], "https://minagricultura.example/ya", "no se toca la fila ya existente")
            self.assertEqual(existing_row["content_sha256"], "e" * 64, "ni se le borra un campo que si tenia")

            recovered_titles = {r["title"] for r in rows if r["local_md_path"].endswith(("r1.md", "r2.md"))}
            self.assertEqual(recovered_titles, {"Resolucion perdida 1", "Resolucion perdida 2"})
            recovered = next(r for r in rows if r["local_md_path"].endswith("r1.md"))
            self.assertEqual(recovered["source"], "minambiente")
            # La categoria del frontmatter es la original sin slugificar, y
            # gana sobre la que se podria inferir del nombre de la carpeta.
            self.assertEqual(recovered["category"], "generica")
            self.assertEqual(recovered["url"], "https://minambiente.example/r1.md")
            # Lo que no se puede recuperar honestamente se deja vacio, no inventado.
            self.assertEqual(recovered["content_sha256"], "")
            self.assertEqual(recovered["http_status"], "")

    def test_recover_reports_files_without_valid_frontmatter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            roto_dir = output_dir / "concejo_envigado" / "paginas_md" / "actas"
            roto_dir.mkdir(parents=True)
            (roto_dir / "sin-frontmatter.md").write_text("# Un acta cualquiera\n\ntexto.\n", encoding="utf-8")

            added, kept, unparsed = recover(output_dir)
            self.assertEqual(added, 0)
            self.assertEqual(kept, 0)
            self.assertEqual(len(unparsed), 1)
            self.assertTrue(str(unparsed[0]).endswith("sin-frontmatter.md"))


class MetadataStoreTests(unittest.TestCase):
    def test_reload_keeps_history_from_a_different_source(self) -> None:
        # Hallazgo A-7: una corrida sobre una fuente nueva no debia borrar la
        # metadata que dejo una corrida anterior sobre otra fuente. El bug
        # afectaba a las tres tablas que flush() reescribe enteras cada vez:
        # paginas.csv perdia el catalogo porque no se recargaba; urls_visitadas
        # y errores ni siquiera tenian un metodo de recarga que intentarlo.
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            page_path = output_dir / "paginas_md" / "pagina.md"
            page_path.parent.mkdir(parents=True)
            page_path.write_text("# contenido", encoding="utf-8")

            first = MetadataStore(output_dir)
            first.add("paginas", {
                "id": "page-000001", "title": "Resolucion 1541", "url": "https://a.example/1541",
                "local_md_path": "paginas_md/pagina.md", "category": "generica", "depth": 1,
                "http_status": 200, "content_length": 100, "content_sha256": "a" * 64,
                "scraped_at": "2026-01-01T00:00:00", "dynamic_suspected": False,
                "source": "minambiente",
            })
            first.add("urls_visitadas", {
                "url": "https://a.example/1541", "normalized_url": "https://a.example/1541",
                "depth": 1, "status": 200, "content_type": "text/html",
                "parent_url": "https://a.example/", "visited_at": "2026-01-01T00:00:00",
                "source": "minambiente",
            })
            first.add("errores", {
                "url": "https://a.example/roto", "parent_url": "https://a.example/",
                "error_type": "http_error", "error_message": "404",
                "timestamp": "2026-01-01T00:00:00", "source": "minambiente",
            })
            first.flush()

            second = MetadataStore(output_dir)
            second.add("paginas", {
                "id": "page-000002", "title": "Otra pagina", "url": "https://b.example/otra",
                "local_md_path": "paginas_md/otra.md", "category": "generica", "depth": 1,
                "http_status": 200, "content_length": 50, "content_sha256": "b" * 64,
                "scraped_at": "2026-01-02T00:00:00", "dynamic_suspected": False,
                "source": "concejo_envigado",
            })
            second.flush()

            def read(table: str) -> list[dict[str, str]]:
                path = output_dir / "metadata" / f"{table}.csv"
                with path.open(encoding="utf-8-sig", newline="") as stream:
                    return list(csv.DictReader(stream))

            paginas = read("paginas")
            self.assertEqual(
                len(paginas), 2,
                "la pagina de minambiente debe sobrevivir a la corrida de concejo_envigado",
            )
            self.assertEqual(
                {row["source"] for row in paginas}, {"minambiente", "concejo_envigado"},
            )
            self.assertEqual(
                {row["title"] for row in paginas}, {"Resolucion 1541", "Otra pagina"},
            )

            visitadas = read("urls_visitadas")
            self.assertEqual(
                len(visitadas), 1,
                "urls_visitadas.csv no tenia ningun metodo de recarga antes de esta correccion",
            )
            self.assertEqual(visitadas[0]["source"], "minambiente")

            errores = read("errores")
            self.assertEqual(
                len(errores), 1, "errores.csv tenia el mismo problema que urls_visitadas.csv",
            )
            self.assertEqual(errores[0]["source"], "minambiente")

    def test_reload_assigns_legacy_source_to_rows_without_one(self) -> None:
        # Filas de antes del crawler multi-fuente no tienen columna "source".
        # _load_existing_documents ya las etiquetaba como "ambientometro";
        # paginas, urls_visitadas y errores deben hacer lo mismo al recargar.
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            metadata_dir = output_dir / "metadata"
            metadata_dir.mkdir(parents=True)
            page_path = output_dir / "paginas_md" / "vieja.md"
            page_path.parent.mkdir(parents=True)
            page_path.write_text("# contenido", encoding="utf-8")

            with (metadata_dir / "paginas.csv").open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=[
                    "id", "title", "url", "local_md_path", "category", "depth",
                    "http_status", "content_length", "content_sha256", "scraped_at",
                    "dynamic_suspected",
                ])
                writer.writeheader()
                writer.writerow({
                    "id": "page-000001", "title": "Pagina vieja", "url": "https://a.example/vieja",
                    "local_md_path": "paginas_md/vieja.md", "category": "generica", "depth": 1,
                    "http_status": 200, "content_length": 10, "content_sha256": "c" * 64,
                    "scraped_at": "2020-01-01T00:00:00", "dynamic_suspected": False,
                })

            store = MetadataStore(output_dir)
            self.assertEqual(len(store.rows["paginas"]), 1)
            self.assertEqual(store.rows["paginas"][0]["source"], "ambientometro")


class ReportTests(unittest.TestCase):
    def test_report_includes_authorized_sources(self) -> None:
        manifest = {
            "pages_visited": 7, "documents_found": 3, "documents_downloaded": 3,
            "pages_saved_as_markdown": 6, "documents_skipped_filter": 0,
            "duplicates_skipped": 1, "errors": 0, "by_document_type": {},
        }
        output = StringIO()
        with redirect_stdout(output):
            print_report({"gmas2_envigado": manifest, "observatorio_geotrends": manifest}, Path("salida"), False)
        report = output.getvalue()
        self.assertIn("GMAS2 ENVIGADO", report)
        self.assertIn("OBSERVATORIO GEOTRENDS", report)
        self.assertIn("Duplicados globales: 2", report)
        self.assertNotIn("CONCEJO", report)

if __name__ == "__main__":
    unittest.main()
