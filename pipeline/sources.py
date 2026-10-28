"""Download and cache the raw inputs.

Every source is cached under pipeline/raw/. Pass refresh=True (or run
`build.py --refresh`) to download them again.
"""

from __future__ import annotations

import hashlib
import io
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

RAW = Path(__file__).parent / "raw"
USER_AGENT = "global-leader-population-gap/0.1 (data pipeline; python-urllib)"

URLS = {
    # UN World Population Prospects 2024: population by single year of age
    # (estimates to 2023, medium-variant projection afterwards).
    "wpp_single_age_1950_2023.csv.gz": "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_PopulationBySingleAgeSex_Medium_1950-2023.csv.gz",
    "wpp_single_age_2024_2100.csv.gz": "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz",
    # Continent of each country (Our World in Data).
    "continents.csv": "https://ourworldindata.org/grapher/continents-according-to-our-world-in-data.csv?v=1&csvType=full&useColumnShortNames=true",
    # REIGN (Bell, Besaw & Frank), monthly effective leaders 1950 - Aug 2021.
    "reign.csv": "https://raw.githubusercontent.com/OEFDataScience/REIGN.github.io/gh-pages/data_sets/REIGN_2021_8.csv",
    # Archigos 4.1 (Goemans, Gleditsch & Chiozza), leader birth dates.
    "archigos.dta": "https://www.rochester.edu/college/faculty/hgoemans/Archigos_4.1_stata14.dta",
}

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        dest.write_bytes(resp.read())


def fetch(name: str, refresh: bool = False) -> Path:
    RAW.mkdir(exist_ok=True)
    dest = RAW / name
    if refresh or not dest.exists():
        print(f"  downloading {name}")
        _download(URLS[name], dest)
    return dest


def sparql(name: str, query: str, refresh: bool = False) -> pd.DataFrame:
    """Run a Wikidata SPARQL query, caching the CSV result in raw/ (keyed by
    the query text, so editing a query invalidates its cache)."""
    RAW.mkdir(exist_ok=True)
    digest = hashlib.sha1(query.encode()).hexdigest()[:10]
    dest = RAW / f"{name}-{digest}.csv"
    if refresh or not dest.exists():
        print(f"  querying Wikidata: {name}")
        req = urllib.request.Request(
            SPARQL_ENDPOINT,
            data=urllib.parse.urlencode({"query": query}).encode(),
            headers={"User-Agent": USER_AGENT, "Accept": "text/csv"},
        )
        attempts = 6
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(req, timeout=180) as resp:
                    dest.write_bytes(resp.read())
                break
            except Exception as exc:  # noqa: BLE001 - Wikidata is flaky; retry
                if attempt == attempts - 1:
                    raise
                # The query service sometimes throttles to ~1 request/minute.
                retry_after = getattr(exc, "headers", None) and exc.headers.get("Retry-After")
                wait = int(retry_after) if retry_after and retry_after.isdigit() else 65
                print(f"    {exc}; retrying in {wait}s")
                time.sleep(wait)
    text = dest.read_text(encoding="utf-8")
    return pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
