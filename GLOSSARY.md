# Leader–population age gap

Compares, for every country and year since 1960, the age of the person who actually holds power with the average age of the people they govern.

## Language

### Leaders

**Effective leader**:
The person who actually holds power in a country at a given moment, in the Archigos sense: the US president, the UK prime minister, the Chinese party chief, a junta chief after a coup. Not necessarily the head of state or the head of government.
_Avoid_: Head of state, ruler, president

**Leader of the year**:
The effective leader who held power for the most days in a calendar year. Every other effective leader in office that year is an "other leader" for that year.
_Avoid_: Leader on 1 July, current leader

**Acting leader**:
Someone who temporarily holds the tracked office (e.g. after a removal or death). An acting leader is the effective leader while they hold it. A suspended office holder stays the effective leader until formally replaced.
_Avoid_: Interim leader, caretaker

**Leaderless period**:
Days when a country has no effective leader. Before September 2021 this follows REIGN's coding (e.g. Somalia 1991–2012, during the state collapse); after that it is always a data error.
_Avoid_: Vacancy, interregnum

**Tracked office**:
The office (head of state or head of government, or a hand-picked office) whose holders continue a country's series after REIGN ends in August 2021.
_Avoid_: Position, role

**Collective leadership**:
A country where several people share the top office equally (e.g. a three-member presidency), so it has no single effective leader. Such a country has no leader of the year.
_Avoid_: Rotating presidency, joint leadership

**Parent state**:
The larger state whose effective leader is shown for a territory before it became independent (e.g. Yugoslavia for Croatia before 1991).
_Avoid_: Former country, predecessor, union

### Population and gap

**Population mean age**:
The average age of a country's residents on 1 July, taken from the UN's population counts by single year of age.
_Avoid_: Median age, average age

**Leader age**:
The leader of the year's age on 1 July of that year.

**Gap**:
Leader age minus population mean age, in years. Positive means the leader is older than the average resident.
_Avoid_: Age difference, age gap (unqualified)

**Projected year**:
A year whose population mean age comes from the UN medium-variant projection instead of an estimate.
_Avoid_: Forecast, estimate

**Population-weighted gap**:
The average gap across countries, with each country counted in proportion to its population.
_Avoid_: World gap, global average

### Curation

**Curation**:
A hand-made decision that overrides what the sources say (a different tracked office, a manual leader spell, an excluded office holder, a corrected name or birth date), always shown to readers with a reason.
_Avoid_: Fix, patch, override

**Uncovered territory**:
A place with no data at all because REIGN does not treat it as a country (Taiwan, Palestine). Unlike a collective leadership, it is listed in the caveats rather than shown as a gap in a series.
_Avoid_: Missing country
