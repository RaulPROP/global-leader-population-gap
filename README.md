<img src="assets/icon.svg" width="64" height="64" alt="">

# global-leader-population-gap

How much older (or younger) is a country's leader than its population?
For every country and every year since 1960, this compares the age of the
country's **effective leader** with the **mean (average) age of its population**, and
shows the result in an interactive website (world map, per-country history,
global trend, sortable table).

## Run the website

```sh
cd web
npm install
npm run dev        # http://localhost:5173
```

`npm run build` produces a static site in `web/dist/` that can be hosted anywhere.
After rebuilding the data, `npm run og` re-renders the social preview image
(`web/public/og.png`) with headless Chrome; set `CHROME` to its path if it is not `chromium`.
The data it reads is `web/public/data/gap.json`, which is checked in.

## Deploy

`.github/workflows/deploy.yml` runs `pipeline/validate.py` and builds the site on
every push and pull request, and publishes `web/dist` to GitHub Pages from
`main`. One-time setup: make the repository public (Pages needs that on a free
plan) and set **Settings → Pages → Source** to **GitHub Actions**. The site is
then at https://raulprop.github.io/global-leader-population-gap/.

## Rebuild the data

```sh
cd pipeline
uv run build.py            # uses cached downloads in pipeline/raw/
uv run build.py --refresh  # re-download everything (Wikidata included)
```

The Wikidata query service sometimes throttles to one request per minute; the
pipeline waits and retries, so a refresh can take a few minutes.

Every build ends by running `validate.py` against the previous `gap.json` and
exits with an error if the data must not be published (impossible ages, a
leaderless period after Aug 2021, overlapping leaders, lost country-years).
Run it on its own with `uv run validate.py`. Terms are defined in
[GLOSSARY.md](GLOSSARY.md).

## Data and license

`web/public/data/gap.csv` has one row per country and year (leader, birth date,
ages, gap, population). The data is CC BY 4.0 with credit to its sources (see
[DATA-LICENSE.md](DATA-LICENSE.md)); the code is MIT ([LICENSE](LICENSE)).

## Method

| | Source |
|---|---|
| Population mean age (and population, for weighting) | Computed from UN World Population Prospects 2024 population by single year of age (each age counted at its midpoint, 100+ at 102). Estimates to 2023, medium-variant projection after. |
| Effective leader, 1950 – Aug 2021 | [REIGN](https://oefdatascience.github.io/REIGN.github.io/) (monthly), which follows the [Archigos](https://www.rochester.edu/college/faculty/hgoemans/data.htm) definition of effective leader |
| Effective leader, Sep 2021 – today | Wikidata holders of the same office REIGN was tracking for that country (head of state `P35` or head of government `P6`, chosen automatically by matching REIGN's last leader) |
| Names and birth dates | Wikidata (English Wikipedia title as the name) for leaders matched by country, office dates and name; else Archigos; else inferred from REIGN's monthly ages |

* Ages are measured on 1 July (the UN's reference date). Gap = leader age − mean age.
* The leader of a year is whoever held office for the most days that year; in the
  current year, whoever is in office today counts as staying until 31 December.
* Today's borders: former Soviet / Yugoslav / Czechoslovak republics show the
  union's leader before independence; Germany before 1990 shows West Germany,
  Yemen before 1990 North Yemen, Vietnam before 1976 North Vietnam.

### Hand-curated decisions (`pipeline/config/`)

* `countries.csv` – Correlates of War code → ISO3 mapping, incl. historical states.
* `offices.csv` – countries where the office to follow after 2021 is set by hand
  (e.g. Vietnam's party General Secretary, Swiss President, Thai PM).
* `manual_leaders.csv` – leader spells that override everything else for their
  window (e.g. Iran's Supreme Leader instead of the president, Myanmar's junta chief).
* `exclude.csv` – Wikidata office holders who never held effective power (e.g. Guaidó).
* `names.csv` – display names, keyed by Wikidata QID or REIGN leader key
  (`reign:<COW code>:<REIGN name>`), for vandalised labels and surname-only REIGN names.
* `links.csv` – REIGN leaders linked to a Wikidata person by hand (or, with an
  empty `qid`, kept from being linked) when the automatic match fails or is wrong.

The decisions about who led (`offices.csv`, `manual_leaders.csv`, `exclude.csv`)
are listed on the website's "About the data" section.
