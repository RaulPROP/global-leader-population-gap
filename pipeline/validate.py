"""Sanity checks on the built dataset.

    uv run validate.py                            # checks web/public/data/gap.json
    uv run validate.py gap.json --baseline old.json

Errors (exit code 1) mean the data must not be published:
  * a leader of the year younger than 15 or older than 100;
  * a gap that is not leader age minus mean age;
  * a leaderless period of more than a week after REIGN ends (before that,
    REIGN's own coding is the authority, e.g. Somalia 1991-2012);
  * two different leaders in office together for more than two months;
  * compared with the baseline, a country or country-year that disappeared.

Warnings are printed for a human to judge but do not fail the build.
build.py runs these checks after every build, against the previous output.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

DEFAULT = Path(__file__).parent.parent / "web" / "public" / "data" / "gap.json"

MIN_LEADER_AGE, MAX_LEADER_AGE = 15, 100
MAX_LEADERLESS_DAYS = 7
MAX_OVERLAP_DAYS = 62  # REIGN's monthly data overlaps a month at handovers


def day(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def leaderless(spells: list[dict], start: dt.date, end: dt.date) -> list[tuple[dt.date, dt.date]]:
    """Periods within [start, end] that no spell covers."""
    out = []
    cursor = start
    for s in sorted(spells, key=lambda s: s["start"]):
        a, b = day(s["start"]), day(s["end"])
        if b < cursor:
            continue
        if a > cursor:
            out.append((cursor, min(a, end + dt.timedelta(days=1)) - dt.timedelta(days=1)))
        cursor = max(cursor, b + dt.timedelta(days=1))
        if cursor > end:
            break
    if cursor <= end:
        out.append((cursor, end))
    return [(a, b) for a, b in out if b >= a]


def check(ds: dict, baseline: dict | None = None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    leaders = ds["leaders"]
    name = lambda i: leaders[i]["name"]  # noqa: E731
    countries = {c["iso3"] for c in ds["countries"]}
    untracked = {c["iso3"] for c in ds["curation"] if c["kind"] == "untracked"}
    reign_end = day(ds["reignEnd"])
    generated = day(ds["generated"])

    if countries != set(ds["series"]):
        errors.append(f"countries and series differ: {sorted(countries ^ set(ds['series']))}")

    for iso, rows in ds["series"].items():
        for r in rows:
            where = f"{iso} {r['y']}"
            if not ds["firstYear"] <= r["y"] <= ds["lastYear"]:
                errors.append(f"{where}: year out of range")
            if not 0 <= r["l"] < len(leaders):
                errors.append(f"{where}: unknown leader index {r['l']}")
                continue
            if r["la"] is None:
                continue
            if not MIN_LEADER_AGE <= r["la"] <= MAX_LEADER_AGE:
                errors.append(f"{where}: {name(r['l'])} aged {r['la']:.0f}")
            if abs(r["gap"] - (r["la"] - r["ma"])) > 0.011:
                errors.append(f"{where}: gap {r['gap']} != {r['la']} - {r['ma']}")

    for iso, spells in ds["spells"].items():
        for a, b in leaderless(spells, day(min(s["start"] for s in spells)), reign_end):
            if (b - a).days + 1 > 31:
                warnings.append(f"{iso}: no leader {a} – {b} (REIGN's coding)")
        if iso in untracked:
            continue
        for a, b in leaderless(spells, reign_end + dt.timedelta(days=1), generated):
            if (b - a).days + 1 > MAX_LEADERLESS_DAYS:
                errors.append(f"{iso}: no leader {a} – {b} ({(b - a).days + 1} days)")
        for i, s in enumerate(spells):
            for t in spells[i + 1:]:
                if s["l"] == t["l"]:
                    continue
                days = (min(day(s["end"]), day(t["end"])) - max(day(s["start"]), day(t["start"]))).days + 1
                if days > MAX_OVERLAP_DAYS:
                    errors.append(f"{iso}: {name(s['l'])} and {name(t['l'])} both in office for {days} days from "
                                  f"{max(s['start'], t['start'])}")

    if baseline:
        for iso, rows in baseline["series"].items():
            old = {r["y"] for r in rows}
            new = {r["y"] for r in ds["series"].get(iso, [])}
            if not new:
                errors.append(f"{iso}: country disappeared")
            elif lost := sorted(old - new):
                errors.append(f"{iso}: lost years {lost}")

    unknown = [l["name"] for l in leaders if l["bornPrecision"] == "unknown" and not l.get("collective")]
    if unknown:
        warnings.append(f"no birth date for {len(unknown)} leaders: {', '.join(unknown)}")
    surnames = [l["name"] for l in leaders if len(l["name"].split()) == 1]
    if surnames:
        warnings.append(f"{len(surnames)} leaders have a one-word name, e.g. {', '.join(surnames[:8])}")
    warnings += ds.get("warnings", [])
    return errors, warnings


def report(errors: list[str], warnings: list[str]) -> bool:
    for w in warnings:
        print("  WARN", w)
    for e in errors:
        print("  ERROR", e)
    print(f"Validation: {len(errors)} errors, {len(warnings)} warnings")
    return not errors


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?", type=Path, default=DEFAULT)
    ap.add_argument("--baseline", type=Path, help="previous gap.json; fail if country-years were lost")
    args = ap.parse_args()
    ds = json.loads(args.path.read_text(encoding="utf-8"))
    baseline = json.loads(args.baseline.read_text(encoding="utf-8")) if args.baseline else None
    sys.exit(0 if report(*check(ds, baseline)) else 1)


if __name__ == "__main__":
    main()
