"""Crawler multi-fuente para construir un corpus documental institucional."""

from .config import ScraperConfig
from .crawler import AmbientometroCrawler, SourceCrawler
from .sources import SOURCES, SourceDefinition, get_source

__all__ = [
    "AmbientometroCrawler", "ScraperConfig", "SourceCrawler",
    "SOURCES", "SourceDefinition", "get_source",
]
