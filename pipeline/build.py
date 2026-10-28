"""Build the leader-age vs population-mean-age dataset.

    uv run build.py            # use cached raw inputs where present
    uv run build.py --refresh  # re-download everything (incl. Wikidata)

Output: ../web/public/data/gap.json, then checked by validate.py (exit 1 on errors).

Method, in short:
  * Population mean age: computed from UN WPP 2024 population by single year
    of age; estimates up to 2023, medium-variant projection afterwards.
  * Effective leader, 1950 - Aug 2021: REIGN (monthly), whose leader coding
    follows Archigos' "effective leader" definition.
  * Effective leader, Sep 2021 onwards: Wikidata holders of the office REIGN
    was tracking for that country (head of state P35, head of government P6,
    or a specific office); see config/offices.csv and config/manual_leaders.csv.
  * Birth dates: Archigos where a matching leader is found, otherwise inferred
    from REIGN's monthly age column; Wikidata for post-2021 leaders.
  * The leader of a country in a year is whoever held office for the most days
    of that calendar year. Ages are measured at mid-year (1 July), the same
    reference date the UN uses for its population estimates.
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import re
import unicodedata
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

import sources
import validate

HERE = Path(__file__).parent
CONFIG = HERE / "config"
OUT = HERE.parent / "web" / "public" / "data" / "gap.json"

FIRST_YEAR = 1960
TODAY = dt.date.today()
LAST_YEAR = TODAY.year
REIGN_END = dt.date(2021, 8, 31)
WIKIDATA_START = REIGN_END + dt.timedelta(days=1)
HISTORICAL_REIGN_NAMES = {"Soviet Union": "the Soviet Union", "Yugoslavia": "Yugoslavia", "Czechoslovakia": "Czechoslovakia"}
LABEL_LANGS = "en,mul,es,fr,de,pt,it"


# ---------------------------------------------------------------- helpers


def decimal_year(d: dt.date) -> float:
    start = dt.date(d.year, 1, 1)
    days = (dt.date(d.year + 1, 1, 1) - start).days
    return d.year + (d - start).days / days


def from_decimal_year(x: float) -> dt.date:
    year = int(x)
    start = dt.date(year, 1, 1)
    days = (dt.date(year + 1, 1, 1) - start).days
    return start + dt.timedelta(days=int(round((x - year) * days)))


def norm_name(s: str) -> str:
    s = re.sub(r"[\u02bb\u02bc\u2018\u2019'`-]", " ", s)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z ]", " ", s.lower()).strip()


def name_similarity(a: str, b: str) -> float:
    a, b = norm_name(a), norm_name(b)
    if not a or not b:
        return 0.0
    ta, tb = set(a.split()), set(b.split())
    token = len(ta & tb) / min(len(ta), len(tb))
    return max(token, difflib.SequenceMatcher(None, a, b).ratio())


def parse_wd_date(s: str) -> dt.date | None:
    if not s:
        return None
    m = re.match(r"^(-?\d+)-(\d\d)-(\d\d)", s)
    if not m:
        return None
    y, mo, d = int(m[1]), max(int(m[2]), 1), max(int(m[3]), 1)
    if y < 1 or y > 9999:
        return None
    return dt.date(y, mo, d)


def qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


# ---------------------------------------------------------------- leaders


@dataclass
class Leader:
    key: str
    name: str
    birth: float | None = None  # decimal year
    birth_precision: str = "unknown"  # day | month | year | estimated | unknown
    qid: str | None = None
    wiki_title: str | None = None
    sources: set[str] = field(default_factory=set)

    def birth_label(self) -> str | None:
        if self.birth is None:
            return None
        d = from_decimal_year(self.birth)
        if self.birth_precision == "day":
            return d.isoformat()
        if self.birth_precision == "month":
            return d.strftime("%Y-%m")
        return str(d.year)


@dataclass
class Spell:
    iso3: str
    leader: str  # Leader.key
    start: dt.date
    end: dt.date
    source: str
    via: str | None = None


# ---------------------------------------------------------------- population


# Age assumed for the open-ended "100+" group when averaging.
AGE_100_PLUS = 102.0
# The UN codes Kosovo as XKX; Our World in Data (continents) as OWID_KOS.
UN_ISO_FIXES = {"XKX": "OWID_KOS"}


def load_population_tables(refresh: bool):
    """Mean age and total population per (iso3, year) from the UN's population
    by single year of age. Returns (mean_age, population, names, continents);
    mean_age maps to (value, is_projection)."""
    frames = []
    for name, projected in (
        ("wpp_single_age_1950_2023.csv.gz", False),
        ("wpp_single_age_2024_2100.csv.gz", True),
    ):
        for chunk in pd.read_csv(
            sources.fetch(name, refresh),
            usecols=["ISO3_code", "LocTypeName", "Time", "AgeGrpStart", "AgeGrpSpan", "PopTotal"],
            dtype={"ISO3_code": str, "LocTypeName": str},
            chunksize=500_000,
        ):
            chunk = chunk[
                chunk.LocTypeName.isin(["Country/Area", "World"])
                & (chunk.Time >= FIRST_YEAR)
                & (chunk.Time <= LAST_YEAR)
            ]
            chunk = chunk.assign(projected=projected)
            frames.append(chunk)
    df = pd.concat(frames)
    df["iso3"] = df.ISO3_code.where(df.LocTypeName != "World", "OWID_WRL").replace(UN_ISO_FIXES)
    # Single years of age [x, x+1) count at their midpoint.
    df["age"] = (df.AgeGrpStart + 0.5).where(df.AgeGrpSpan == 1, AGE_100_PLUS)
    df["weighted"] = df.age * df.PopTotal
    g = df.groupby(["iso3", "Time"]).agg(
        weighted=("weighted", "sum"), total=("PopTotal", "sum"), projected=("projected", "first")
    )
    mean_age = {
        (iso, int(year)): (round(r.weighted / r.total, 2), bool(r.projected))
        for (iso, year), r in g.iterrows()
        if r.total > 0
    }
    population = {(iso, int(year)): int(round(r.total * 1000)) for (iso, year), r in g.iterrows()}

    cont = pd.read_csv(sources.fetch("continents.csv", refresh))
    names = dict(zip(cont.code, cont.entity))
    continents = dict(zip(cont.code, cont.owid_region))
    return mean_age, population, names, continents


# ---------------------------------------------------------------- REIGN + Archigos


def decode_dbpedia(uri: str) -> str | None:
    """Archigos stores DBpedia URIs wrapped in a proofpoint redirect."""
    m = re.search(r"dbpedia\.org_resource_([^&]+)", uri or "")
    if not m:
        return None
    raw = m[1]
    raw = re.sub(r"-([0-9A-F]{2})", lambda x: chr(int(x[1], 16)), raw)
    title = urllib.parse.unquote(raw).replace("_", " ").strip()
    try:
        title = title.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return title or None


def load_archigos(refresh: bool) -> pd.DataFrame:
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        a = pd.read_stata(sources.fetch("archigos.dta", refresh))
    a["start"] = pd.to_datetime(a.startdate, errors="coerce").dt.date
    a["end"] = pd.to_datetime(a.enddate, errors="coerce").dt.date
    a["wiki_title"] = a.dbpediauri.map(decode_dbpedia).astype(object).where(lambda x: x.notna(), "")
    return a[a.end.notna() & (a.end >= dt.date(FIRST_YEAR - 10, 1, 1))]


def birth_bounds(obs: list[tuple[float, float]]) -> tuple[float, float]:
    """Birth date (decimal year) bounds implied by monthly (t, age) readings:
    each reading puts the birth date in (t - age - 1, t - age]."""
    return max(t - a - 1 for t, a in obs), min(t - a for t, a in obs)


def build_reign(refresh: bool, mapping: pd.DataFrame, leaders: dict[str, Leader]) -> list[Spell]:
    r = pd.read_csv(
        sources.fetch("reign.csv", refresh),
        usecols=["ccode", "country", "leader", "year", "month", "age"],
    )
    r["ccode"] = r.ccode.astype(int)
    r["year"] = r.year.astype(int)
    r["month"] = r.month.astype(int)
    r = r.sort_values(["ccode", "year", "month"], kind="stable")

    # Spells: runs of consecutive months with the same leader name. Months with
    # two leaders (transitions) appear twice, so track every open run.
    @dataclass
    class Run:
        ccode: int
        country: str
        name: str
        start: dt.date
        end: dt.date
        obs: list[tuple[float, float]]

    runs: list[Run] = []
    for (ccode, country), g in r.groupby(["ccode", "country"], sort=False):
        open_runs: dict[str, Run] = {}
        for name, year, month, age in g[["leader", "year", "month", "age"]].itertuples(index=False):
            first = dt.date(year, month, 1)
            last_day = dt.date(year + month // 12, month % 12 + 1, 1) - dt.timedelta(days=1)
            t = year + (month - 0.5) / 12
            run = open_runs.get(name)
            if run and (first - run.end).days <= 1:
                run.end = last_day
                run.obs.append((t, age))
            else:
                run = Run(ccode, country, name, first, last_day, [(t, age)])
                runs.append(run)
                open_runs[name] = run

    # REIGN names are often just surnames, so the same (country, name) can be
    # two different people (Pierre/Justin Trudeau, Jomo/Uhuru Kenyatta).
    # Runs with the same name are one person only if their ages agree.
    persons: list[list[Run]] = []
    by_name: dict[tuple[int, str], list[list[Run]]] = {}
    for run in sorted(runs, key=lambda x: x.start):
        lo, hi = birth_bounds(run.obs)
        mid = (lo + hi) / 2
        for person in by_name.get((run.ccode, run.name), []):
            plo, phi = birth_bounds([o for x in person for o in x.obs])
            if abs((plo + phi) / 2 - mid) <= 1.5:
                person.append(run)
                break
        else:
            person = [run]
            persons.append(person)
            by_name.setdefault((run.ccode, run.name), []).append(person)

    archigos = load_archigos(refresh)
    arch_by_ccode = {c: g for c, g in archigos.groupby("ccode")}

    run_key: dict[int, str] = {}
    for person in persons:
        first = person[0]
        n_same = sum(1 for p in persons if p[0].ccode == first.ccode and p[0].name == first.name)
        idx = next(i for i, p in enumerate(by_name[(first.ccode, first.name)]) if p is person)
        key = f"reign:{first.ccode}:{first.name}" + (f":{idx + 1}" if n_same > 1 else "")
        for run in person:
            run_key[id(run)] = key

        obs = [o for run in person for o in run.obs]
        lo, hi = birth_bounds(obs)
        if lo <= hi:
            est, prec = (lo + hi) / 2, ("month" if hi - lo <= 0.1 else "estimated")
        else:  # inconsistent ages in the source; fall back to the median reading
            ts = sorted(t - a for t, a in obs)
            est, prec = ts[len(ts) // 2] - 0.5, "estimated"
        leader = Leader(key=key, name=first.name, birth=est, birth_precision=prec, sources={"REIGN"})

        # Archigos match: same country, overlapping tenure, similar name, and a
        # birth date consistent with REIGN's ages.
        cand = arch_by_ccode.get(first.ccode)
        best, best_score = None, 0.0
        if cand is not None:
            for a in cand.itertuples():
                if not any(a.start <= run.end and a.end >= run.start for run in person):
                    continue
                score = name_similarity(first.name, a.leader)
                if a.wiki_title:
                    score = max(score, name_similarity(first.name, a.wiki_title))
                if score > best_score:
                    best, best_score = a, score
        if best is not None and best_score >= 0.5:
            if pd.notna(best.ebirthdate):
                ab, aprec = decimal_year(best.ebirthdate.date()), "day"
            elif best.yrborn and best.yrborn > 0:
                ab, aprec = best.yrborn + 0.5, "year"
            else:
                ab = None
            if ab is not None and abs(ab - est) <= 1.6:
                leader.birth, leader.birth_precision = ab, aprec
                leader.sources.add("Archigos")
                if best.wiki_title:
                    leader.wiki_title = best.wiki_title
                    leader.name = re.sub(r"\s*\(.*\)$", "", best.wiki_title)
        leaders[key] = leader

    spells_by_ccode = [(run.ccode, run.country, run_key[id(run)], run.start, run.end) for run in runs]

    # Map COW states to today's ISO3 territories.
    spells: list[Spell] = []
    for ccode, country, key, s, e in spells_by_ccode:
        for m in mapping[mapping.ccode == ccode].itertuples():
            until = dt.date.fromisoformat(m.until) if m.until else None
            start, end = s, min(e, REIGN_END)
            if until:
                end = min(end, until - dt.timedelta(days=1))
            # The successor's own code takes over from `until`.
            own_until = mapping_until(mapping, m.iso3, ccode)
            if own_until:
                start = max(start, own_until)
            if start > end or end < dt.date(FIRST_YEAR, 1, 1):
                continue
            via = m.via or (
                f"Leader of {HISTORICAL_REIGN_NAMES[country]}, of which this country was part"
                if country in HISTORICAL_REIGN_NAMES else None
            )
            spells.append(Spell(m.iso3, key, start, end, "REIGN", via or None))
    return spells


def mapping_until(mapping: pd.DataFrame, iso3: str, ccode: int) -> dt.date | None:
    """If `ccode` is the successor's own code, its spells start at the
    predecessor's `until` date (e.g. Ukraine's own leaders from independence)."""
    rows = mapping[(mapping.iso3 == iso3) & (mapping.ccode != ccode) & (mapping.until != "")]
    own = mapping[(mapping.iso3 == iso3) & (mapping.ccode == ccode)]
    if rows.empty or own.empty or own.iloc[0].until:
        return None
    return max(dt.date.fromisoformat(u) for u in rows.until)


# ---------------------------------------------------------------- Wikidata


def wikidata_countries(isos: list[str], refresh: bool) -> tuple[dict[str, str], dict[str, dict[str, set[str]]]]:
    """Country QIDs, plus the offices Wikidata says are held by the head of
    state (P1906) and head of government (P1313)."""
    values = " ".join(f'"{i}"' for i in isos if len(i) == 3)
    df = sources.sparql(
        "wd_countries",
        f"""
        SELECT ?iso ?country ?hs ?hg ?n WHERE {{
          {{
            SELECT ?iso ?country (COUNT(?h) AS ?n) WHERE {{
              VALUES ?iso {{ {values} }}
              ?country wdt:P298 ?iso .
              OPTIONAL {{ ?country p:P35|p:P6 ?h }}
            }} GROUP BY ?iso ?country
          }}
          OPTIONAL {{ ?country wdt:P1906 ?hs }}
          OPTIONAL {{ ?country wdt:P1313 ?hg }}
        }}
        """,
        refresh,
    )
    df["n"] = df.n.astype(int)
    best = df.sort_values("n", ascending=False).drop_duplicates("iso")
    qids = {r.iso: qid(r.country) for r in best.itertuples()}
    qids["OWID_KOS"] = "Q1246"
    offices: dict[str, dict[str, set[str]]] = {}
    for r in df.itertuples():
        if qids.get(r.iso) != qid(r.country):
            continue
        o = offices.setdefault(r.iso, {"P35": set(), "P6": set()})
        if r.hs:
            o["P35"].add(qid(r.hs))
        if r.hg:
            o["P6"].add(qid(r.hg))
    return qids, offices


WD_PERSON_FIELDS = """
  OPTIONAL { ?person p:P569 ?bst . ?bst psv:P569 [ wikibase:timeValue ?birth ; wikibase:timePrecision ?birthPrec ] }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "%s". ?person rdfs:label ?personLabel . }
""" % LABEL_LANGS

WD_STATEMENT_FIELDS = """
  ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
  FILTER(!BOUND(?end) || ?end >= "2020-01-01T00:00:00Z"^^xsd:dateTime)
"""


def wikidata_heads(country_qids: dict[str, str], refresh: bool) -> pd.DataFrame:
    """P35/P6 statements on the country items."""
    values = " ".join(f"(wd:{q} \"{iso}\")" for iso, q in country_qids.items())
    return sources.sparql(
        "wd_heads",
        f"""
        SELECT ?iso ?role ?person ?personLabel ?birth ?birthPrec ?start ?end WHERE {{
          VALUES (?country ?iso) {{ {values} }}
          VALUES (?role ?p ?ps) {{ ("P35" p:P35 ps:P35) ("P6" p:P6 ps:P6) }}
          ?country ?p ?st . ?st ?ps ?person .
          {WD_STATEMENT_FIELDS}
          {WD_PERSON_FIELDS}
        }}
        """,
        refresh,
    )


def wikidata_office_holders(offices: list[str], refresh: bool) -> pd.DataFrame:
    """P39 (position held) statements for the given offices."""
    values = " ".join(f"wd:{q}" for q in sorted(offices))
    return sources.sparql(
        "wd_offices",
        f"""
        SELECT ?office ?person ?personLabel ?birth ?birthPrec ?start ?end WHERE {{
          VALUES ?office {{ {values} }}
          ?person p:P39 ?st . ?st ps:P39 ?office .
          {WD_STATEMENT_FIELDS}
          {WD_PERSON_FIELDS}
        }}
        """,
        refresh,
    )


def wikidata_people(qids: list[str], refresh: bool) -> pd.DataFrame:
    values = " ".join(f"wd:{q}" for q in qids)
    return sources.sparql(
        "wd_people",
        f"""
        SELECT ?person ?personLabel ?birth ?birthPrec WHERE {{
          VALUES ?person {{ {values} }}
          {WD_PERSON_FIELDS}
        }}
        """,
        refresh,
    )


def wd_births(rows: pd.DataFrame) -> list[tuple[float, str]]:
    """A person's usable P569 values, most precise first. Wikidata sometimes
    carries conflicting birth dates, so callers may pick among them."""
    found: dict[float, int] = {}
    for r in rows.itertuples():
        d = parse_wd_date(r.birth)
        if d is None or not r.birthPrec or int(r.birthPrec) < 9:  # decade/century: useless
            continue
        prec = int(r.birthPrec)
        if prec >= 11:
            x, p = decimal_year(d), 11
        elif prec == 10:
            x, p = decimal_year(d.replace(day=15)), 10
        else:
            x, p = d.year + 0.5, 9
        found[x] = max(found.get(x, 0), p)
    label = {11: "day", 10: "month", 9: "year"}
    best = max(found.values(), default=None)
    return [(x, label[p]) for x, p in sorted(found.items()) if p == best]


def pick_birth(cands: list[tuple[float, str]], near: float | None = None) -> tuple[float | None, str]:
    if not cands:
        return None, "unknown"
    if near is None:
        return cands[0]
    return min(cands, key=lambda c: abs(c[0] - near))


@dataclass
class Tenure:
    person: str  # QID
    label: str
    start: dt.date | None
    end: dt.date | None
    source: str = ""  # "country" (P35/P6 on the country) or "P39" (on the person)


def clean_timeline(stmts: list[Tenure]) -> list[Tenure]:
    """Turn raw statements for one office into a timeline.

    * duplicate and overlapping statements for the same person are merged;
    * each tenure ends no later than the day before a different person takes
      over (stale statements often lack an end date);
    * a holder stays in office through a shorter tenure of someone else that
      starts inside theirs (an acting holder during a suspension or absence,
      e.g. Prawit for Prayut, Thailand 2022): the other person only takes over
      once the recorded tenure has ended;
    * statements without a start date only fill the time after the last dated
      tenure (e.g. a new holder whose statement has no qualifiers yet)."""
    dated_people = {t.person for t in stmts if t.start}
    key = lambda t: (t.start, t.end or dt.date.max)  # noqa: E731
    dated = sorted((Tenure(t.person, t.label, t.start, t.end, t.source) for t in stmts if t.start), key=key)
    undated = [t for t in stmts if not t.start and t.person not in dated_people and not t.end]

    # An open statement starting the day the same person's tenure ended is a
    # mis-entered end date (Rajoelina, Madagascar, 2025).
    ends = {(t.person, t.end) for t in dated if t.end}
    dated = [t for t in dated if t.end or (t.person, t.start) not in ends]
    # Year-precision dates read as 1 January. If the same person has a more
    # precise start later that year, the 1 January one is only a year
    # (Schoof, Netherlands: "2024" on the country item, 2 July 2024 on him).
    precise = {(t.person, t.start.year) for t in dated if (t.start.month, t.start.day) != (1, 1)}
    dated = [t for t in dated if (t.start.month, t.start.day) != (1, 1) or (t.person, t.start.year) not in precise]
    # The two sources disagreeing on when the same tenure (same end, or both
    # open) started, by under a year: one is usually the election, the other
    # taking office (Peña, Paraguay: 30 April vs 15 August 2023). Take office.
    # A start both sources agree on stays (Glavchev, Bulgaria, appointed
    # twice in 2024).
    agreed = {(t.person, t.start) for t in dated for u in dated
              if u.person == t.person and u.start == t.start and u.source != t.source}
    moved: dict[dt.date, dt.date] = {}
    for t in dated:
        if (t.person, t.start) in agreed:
            continue
        later = [u.start for u in dated if u.person == t.person and u.end == t.end and u.source != t.source
                 and t.start < u.start <= t.start + dt.timedelta(days=365)]
        if later:
            moved[t.start] = t.start = max(later)
    # The predecessor's statement often ends on the election day as well
    # (Santokhi, Suriname 2025): they stay until the successor takes office.
    for t in dated:
        for old, new in moved.items():
            if t.end and t.start < old and old - dt.timedelta(days=1) <= t.end <= old:
                t.end = new - dt.timedelta(days=1)
    # Only bounded tenures are deferred: an open one starting inside another
    # is a successor with a stale predecessor end date, or junk. When
    # statements disagree on when a tenure ended, trust the earliest end
    # (Oli, Nepal: one statement runs to 2022 across Deuba's tenure).
    first_end: dict[tuple[str, dt.date], dt.date] = {}
    for t in dated:
        if t.end:
            k = (t.person, t.start)
            first_end[k] = min(first_end.get(k, t.end), t.end)
    for t in dated:
        if t.end:
            end = first_end.get((t.person, t.start), t.end)
            for u in dated:
                if u.person != t.person and u.end and t.start < u.start < end:
                    u.start = end + dt.timedelta(days=1)
    dated = sorted((t for t in dated if t.end is None or t.start <= t.end), key=key)

    for i, t in enumerate(dated):
        nxt = [u.start for u in dated[i + 1:] if u.person != t.person and u.start > t.start]
        if nxt:
            cut = min(nxt) - dt.timedelta(days=1)
            t.end = min(t.end or cut, cut)
    merged: list[Tenure] = []
    for t in dated:
        prev = merged[-1] if merged else None
        if prev and prev.person == t.person and (prev.end is None or t.start <= prev.end + dt.timedelta(days=1)):
            prev.end = None if prev.end is None or t.end is None else max(prev.end, t.end)
        else:
            merged.append(Tenure(t.person, t.label, t.start, t.end))

    if undated:
        if not merged:
            return [Tenure(t.person, t.label, None, None) for t in undated]
        last_end = max((t.end for t in merged), key=lambda d: d or dt.date.max)
        if last_end is not None:
            merged += [Tenure(t.person, t.label, last_end + dt.timedelta(days=1), None) for t in undated]
    return merged


def holders_at(timeline: list[Tenure], day: dt.date) -> list[Tenure]:
    return [t for t in timeline if (t.start or dt.date.min) <= day <= (t.end or TODAY)]


def name_tokens(s: str) -> set[str]:
    return {w for w in norm_name(s).split() if len(w) >= 3}


def same_person(label: str, birth: float | None, leader: Leader, birth_precision: str = "unknown") -> bool:
    names = [leader.name] + ([leader.wiki_title] if leader.wiki_title else [])
    known = birth is not None and leader.birth is not None
    diff = abs(birth - leader.birth) if known else None
    if known and diff > 3:  # e.g. Kyriakos vs Konstantinos Mitsotakis
        return False
    if max(name_similarity(label, n) for n in names) >= 0.8:
        return True
    if not known:
        return False
    shared = any(
        difflib.SequenceMatcher(None, a, b).ratio() >= 0.75
        for n in names for a in name_tokens(label) for b in name_tokens(n)
    )
    # REIGN-derived birth dates can be off by a year or so; a shared name
    # token plus a close birth date, or the very same exact birthday, is enough.
    same_birthday = birth_precision == "day" and leader.birth_precision == "day" and diff <= 0.01
    return (shared and diff <= 2.0) or same_birthday


def build_wikidata(
    reign_spells: list[Spell],
    reign_gov: dict[str, str],
    leaders: dict[str, Leader],
    refresh: bool,
) -> tuple[list[Spell], list[Spell], list[str], dict[str, str]]:
    """Returns (spells after REIGN ends, manual override spells, warnings,
    office chosen per country)."""
    offices_cfg = pd.read_csv(CONFIG / "offices.csv", dtype=str, keep_default_na=False)
    forced = dict(zip(offices_cfg.iso3, offices_cfg.office))
    manual = pd.read_csv(CONFIG / "manual_leaders.csv", dtype=str, keep_default_na=False)
    exclude = pd.read_csv(CONFIG / "exclude.csv", dtype=str, keep_default_na=False)
    excluded = set(zip(exclude.iso3, exclude.qid))
    names_cfg = pd.read_csv(CONFIG / "names.csv", dtype=str, keep_default_na=False)
    name_override = dict(zip(names_cfg.qid, names_cfg.name))

    # Countries whose REIGN series runs to the end of the dataset.
    last_reign: dict[str, Spell] = {}
    reign_leaders: dict[str, set[str]] = {}
    for s in reign_spells:
        reign_leaders.setdefault(s.iso3, set()).add(s.leader)
        if s.end >= REIGN_END - dt.timedelta(days=31) and (s.iso3 not in last_reign or s.start >= last_reign[s.iso3].start):
            last_reign[s.iso3] = s
    live = sorted(last_reign)

    country_qids, country_offices = wikidata_countries(live, refresh)
    heads = wikidata_heads({i: country_qids[i] for i in live if i in country_qids}, refresh)
    office_qids = {o for v in country_offices.values() for os_ in v.values() for o in os_}
    office_qids |= {o for o in forced.values() if o.startswith("Q")}
    p39 = wikidata_office_holders(sorted(office_qids), refresh)
    people = wikidata_people(sorted(set(manual.qid)), refresh) if len(manual) else pd.DataFrame()

    birth_cands: dict[str, list[tuple[float, str]]] = {}
    births: dict[str, tuple[float | None, str]] = {}
    labels: dict[str, str] = {}
    for df in (heads, p39, people):
        for person, rows in df.groupby("person"):
            birth_cands[qid(person)] = wd_births(rows)
            births[qid(person)] = pick_birth(birth_cands[qid(person)])
            labels[qid(person)] = name_override.get(qid(person), rows.personLabel.iloc[0])

    def tenures(df: pd.DataFrame, iso: str, source: str) -> list[Tenure]:
        return [
            Tenure(qid(r.person), labels[qid(r.person)], parse_wd_date(r.start), parse_wd_date(r.end), source)
            for r in df.drop_duplicates(["person", "start", "end"]).itertuples()
            # Items with no name in any of our languages are stubs/duplicates.
            if r.personLabel != qid(r.person) and (iso, qid(r.person)) not in excluded
        ]

    # Timelines per country and role: country-item statements plus holders of
    # the matching office.
    timelines: dict[tuple[str, str], list[Tenure]] = {}
    for iso in live:
        offs = country_offices.get(iso, {"P35": set(), "P6": set()})
        for role in ("P35", "P6"):
            stmts = tenures(heads[(heads.iso == iso) & (heads.role == role)], iso, "country")
            stmts += tenures(p39[p39.office.map(qid).isin(offs[role])], iso, "P39")
            timelines[(iso, role)] = clean_timeline(stmts)
        if forced.get(iso, "").startswith("Q"):
            timelines[(iso, forced[iso])] = clean_timeline(tenures(p39[p39.office.map(qid) == forced[iso]], iso, "P39"))

    def matches(iso: str, role: str, leader: Leader) -> bool:
        # REIGN sometimes lags a few weeks behind, so look slightly past its end.
        for day in (REIGN_END, REIGN_END - dt.timedelta(days=45)):
            for t in holders_at(timelines.get((iso, role), []), day):
                b, prec = births.get(t.person, (None, "unknown"))
                if same_person(t.label, b, leader, prec):
                    return True
        return False

    qid_key: dict[tuple[str, str], str] = {}

    def leader_key(iso: str, person: str, label: str, at_cutover: bool = False) -> str:
        """Reuse a REIGN leader of the same country when this is the same
        person (a tenure running across Aug 2021, or a comeback such as
        Trump 2025), so one person never appears as two leaders."""
        if (iso, person) in qid_key:
            return qid_key[(iso, person)]
        b, prec = births.get(person, (None, "unknown"))
        candidates = sorted(reign_leaders.get(iso, ()))
        last = last_reign[iso].leader if iso in last_reign else None
        if at_cutover and last:
            candidates = [last] + [k for k in candidates if k != last]
        for k in candidates:
            rl = leaders[k]
            # Whoever holds office right as REIGN ends is very likely REIGN's
            # last leader, even if REIGN's age for them is off.
            lenient = at_cutover and k == last and name_similarity(label, rl.name) >= 0.8
            if lenient or same_person(label, b, rl, prec):
                # Exact dates (Archigos) win; otherwise take Wikidata's value
                # closest to what we have.
                wb, wprec = pick_birth(birth_cands.get(person, []), rl.birth)
                if wprec == "day" and rl.birth_precision != "day":
                    rl.birth, rl.birth_precision = wb, wprec
                rl.qid = person
                rl.name = label
                rl.sources.add("Wikidata")
                qid_key[(iso, person)] = k
                return k
        key = f"wd:{person}"
        if key not in leaders:
            leaders[key] = Leader(key=key, name=label, birth=b, birth_precision=prec,
                                  qid=person, sources={"Wikidata"})
        qid_key[(iso, person)] = key
        return key

    spells: list[Spell] = []
    warnings: list[str] = []
    chosen: dict[str, str] = {}
    for iso in live:
        rl = leaders[last_reign[iso].leader]
        if iso in forced:
            role = forced[iso]
        else:
            hits = [r for r in ("P35", "P6") if matches(iso, r, rl)]
            default = "P6" if reign_gov.get(iso) == "Parliamentary Democracy" else "P35"
            role = hits[0] if len(hits) == 1 else default
            if not hits:
                at = ", ".join(t.label for t in holders_at(timelines[(iso, default)], WIKIDATA_START)) or "nobody"
                warnings.append(f"{iso}: REIGN ends with {rl.name}; no office matches, using {default} ({at})")
        chosen[iso] = role
        if role in ("none", "manual"):
            continue

        timeline = timelines.get((iso, role), [])
        if not holders_at(timeline, WIKIDATA_START):
            warnings.append(f"{iso}: nobody holds {role} on {WIKIDATA_START}")
        for t in timeline:
            start = max(t.start or WIKIDATA_START, WIKIDATA_START)
            end = min(t.end or TODAY, TODAY)
            b = births.get(t.person, (None,))[0]
            if b is not None and not 18 <= decimal_year(start) - b <= 100:
                warnings.append(f"{iso}: skipping {t.label} (born {b:.0f}) as {role} holder from {start}")
                continue
            if end >= start:
                key = leader_key(iso, t.person, t.label, at_cutover=start == WIKIDATA_START)
                spells.append(Spell(iso, key, start, end, "Wikidata"))

    overrides = [
        Spell(m.iso3, leader_key(m.iso3, m.qid, labels.get(m.qid, m.qid)),
              dt.date.fromisoformat(m.start),
              min(dt.date.fromisoformat(m.end), TODAY) if m.end else TODAY, "Curated")
        for m in manual.itertuples()
    ]
    return spells, overrides, warnings, chosen


def apply_overrides(spells: list[Spell], overrides: list[Spell]) -> list[Spell]:
    """Curated spells replace whatever the datasets say for that country and window."""
    out = spells
    for o in overrides:
        nxt = []
        for s in out:
            if s.iso3 != o.iso3 or s.end < o.start or s.start > o.end:
                nxt.append(s)
                continue
            if s.start < o.start:
                nxt.append(Spell(s.iso3, s.leader, s.start, o.start - dt.timedelta(days=1), s.source, s.via))
            if s.end > o.end:
                nxt.append(Spell(s.iso3, s.leader, o.end + dt.timedelta(days=1), s.end, s.source, s.via))
        out = nxt
    return out + overrides


def merge_spells(spells: list[Spell]) -> list[Spell]:
    """Merge overlapping/adjacent spells of the same leader in the same country."""
    out: list[Spell] = []
    for s in sorted(spells, key=lambda s: (s.iso3, s.leader, s.start)):
        prev = out[-1] if out else None
        if prev and prev.iso3 == s.iso3 and prev.leader == s.leader and s.start <= prev.end + dt.timedelta(days=1):
            prev.end = max(prev.end, s.end)
            prev.via = prev.via or s.via
            if s.source not in prev.source.split("+"):
                prev.source += "+" + s.source
        else:
            out.append(Spell(s.iso3, s.leader, s.start, s.end, s.source, s.via))
    return out


# ---------------------------------------------------------------- assemble


def overlap_days(s: Spell, year: int) -> int:
    a = max(s.start, dt.date(year, 1, 1))
    b = min(s.end, dt.date(year, 12, 31))
    return (b - a).days + 1 if b >= a else 0


def curation_notes() -> list[dict]:
    """Hand-made decisions from config/, surfaced on the website."""
    notes = []
    for f, kind in (("offices.csv", "office"), ("manual_leaders.csv", "curated"), ("exclude.csv", "excluded")):
        df = pd.read_csv(CONFIG / f, dtype=str, keep_default_na=False)
        for r in df.itertuples():
            if r.note:
                k = "untracked" if kind == "office" and r.office == "none" else kind
                notes.append({"iso3": r.iso3, "kind": k, "note": r.note})
    return notes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download all sources")
    args = ap.parse_args()

    print("Population")
    mean_age, population, names, continents = load_population_tables(args.refresh)

    print("Leaders: REIGN + Archigos")
    mapping = pd.read_csv(CONFIG / "countries.csv", dtype={"until": str, "via": str}, keep_default_na=False)
    leaders: dict[str, Leader] = {}
    reign_spells = build_reign(args.refresh, mapping, leaders)

    r = pd.read_csv(sources.fetch("reign.csv"), usecols=["ccode", "year", "month", "government"])
    last = r[(r.year == 2021) & (r.month == 8)]
    ccode_iso = {int(m.ccode): m.iso3 for m in mapping.itertuples() if not m.until}
    reign_gov = {ccode_iso[int(c)]: g for c, g in zip(last.ccode, last.government) if int(c) in ccode_iso}

    print("Leaders: Wikidata (after Aug 2021)")
    wd_spells, overrides, warnings, chosen = build_wikidata(reign_spells, reign_gov, leaders, args.refresh)

    spells = merge_spells(apply_overrides(reign_spells + wd_spells, overrides))
    by_iso: dict[str, list[Spell]] = {}
    for s in spells:
        by_iso.setdefault(s.iso3, []).append(s)

    # Index leaders that are actually used.
    used = sorted({s.leader for s in spells})
    index = {k: i for i, k in enumerate(used)}

    series: dict[str, list[dict]] = {}
    missing_mean = set()
    for iso, ss in sorted(by_iso.items()):
        rows = []
        for year in range(FIRST_YEAR, LAST_YEAR + 1):
            days: dict[str, int] = {}
            via = None
            for s in ss:
                d = overlap_days(s, year)
                if d:
                    days[s.leader] = days.get(s.leader, 0) + d
            if not days:
                continue
            # Most days in office; ties go to whoever started later.
            starts = {s.leader: s.start for s in ss if overlap_days(s, year)}
            top = max(days, key=lambda k: (days[k], starts[k]))
            via = next((s.via for s in ss if s.leader == top and overlap_days(s, year) and s.via), None)
            leader = leaders[top]
            ma = mean_age.get((iso, year))
            if ma is None:
                missing_mean.add(iso)
                continue
            la = round(year + 0.5 - leader.birth, 2) if leader.birth is not None else None
            row = {
                "y": year,
                "l": index[top],
                "ma": ma[0],
                "la": la,
                "gap": round(la - ma[0], 2) if la is not None else None,
            }
            if ma[1]:
                row["proj"] = 1
            if via:
                row["via"] = via
            if len(days) > 1:
                row["others"] = [index[k] for k in sorted(days, key=lambda k: -days[k]) if k != top]
            if (iso, year) in population:
                row["pop"] = population[(iso, year)]
            rows.append(row)
        if rows:
            series[iso] = rows

    if missing_mean:
        print("  WARN no mean age for:", ", ".join(sorted(missing_mean)))

    office_labels = {"P35": "head of state", "P6": "head of government",
                     "Q688230": "President of the Confederation", "Q848786": "Party General Secretary",
                     "manual": "manually curated", "none": "not tracked"}
    countries = [
        {"iso3": iso, "name": names.get(iso, iso), "continent": continents.get(iso),
         **({"officeAfter2021": office_labels.get(chosen[iso], chosen[iso])} if iso in chosen else {})}
        for iso in sorted(series, key=lambda i: names.get(i, i))
    ]
    leader_list = []
    for k in used:
        l = leaders[k]
        item = {"name": l.name, "born": l.birth_label(), "bornPrecision": l.birth_precision,
                "sources": sorted(l.sources)}
        if l.qid:
            item["qid"] = l.qid
        if l.wiki_title:
            item["wiki"] = l.wiki_title
        leader_list.append(item)

    spell_out = {
        iso: [
            {"l": index[s.leader], "start": s.start.isoformat(), "end": s.end.isoformat(),
             "src": s.source, **({"via": s.via} if s.via else {})}
            for s in sorted(ss, key=lambda s: s.start)
            if s.end >= dt.date(FIRST_YEAR, 1, 1)
        ]
        for iso, ss in by_iso.items()
        if iso in series
    }

    world_mean = {
        y: mean_age[("OWID_WRL", y)][0] for y in range(FIRST_YEAR, LAST_YEAR + 1)
        if ("OWID_WRL", y) in mean_age
    }

    out = {
        "generated": TODAY.isoformat(),
        "firstYear": FIRST_YEAR,
        "lastYear": LAST_YEAR,
        "lastEstimateYear": max(y for (i, y), (_, p) in mean_age.items() if not p),
        "reignEnd": REIGN_END.isoformat(),
        "worldMeanAge": world_mean,
        "countries": countries,
        "leaders": leader_list,
        "series": series,
        "spells": spell_out,
        "warnings": warnings,
        "curation": curation_notes(),
    }
    baseline = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_rows = sum(len(v) for v in series.values())
    print(f"Wrote {OUT.relative_to(HERE.parent)}: {len(countries)} countries, {len(leader_list)} leaders, {n_rows} country-years")
    if not validate.report(*validate.check(out, baseline)):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
