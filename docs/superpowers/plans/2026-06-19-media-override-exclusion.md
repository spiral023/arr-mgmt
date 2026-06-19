# Globale Item-Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einzelne Medien-Items (Radarr-Film / Sonarr-Serie) global ausnehmen, sodass sie nicht gegrabbt/gesucht werden, nicht als "Pending FuN" zählen und überall (Automation, manuelle Aktionen, Anzeige) als Override respektiert werden.

**Architecture:** Neue Tabelle `media_item_overrides` (FK auf `media_items`, `on delete cascade`). Eine zentrale Repo-Schicht setzt/liest Overrides und löscht beim Ausnehmen die FuN-Kandidaten. Alle Lesepfade (Pending-FuN-KPIs, Tabellen, Automation-Reconcile) joinen den Override und schließen ausgenommene Items aus; alle Schreibpfade (Automation-Filter + manuelle Such-/Grab-Jobs) überspringen sie. Die UI zeigt ein Override-Badge, eine Toggle-Aktion pro Zeile, eine Bulk-Aktion und einen Sichtbarkeits-Filter.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), better-sqlite3, React + @tanstack/react-table, lucide-react, Vitest.

## Global Constraints

- Override-Granularität: **Item-Ebene** (`media_items`). Eine ausgenommene Serie nimmt alle Episoden mit.
- Manueller Grab/Suche für ausgenommene Items wird **hart blockiert** (übersprungen).
- Beim Ausnehmen (`excluded:true`) werden die zugehörigen `release_candidates` **gelöscht**; beim Wieder-Aufnehmen (`excluded:false`) bleibt die Override-Zeile erhalten (`is_excluded = 0`), `created_at`/`note` unverändert.
- Ausgenommene Items **bleiben sichtbar** (Override-Badge), zählen nicht als Pending FuN, sind per Filter aus-/einblendbar.
- Tests: Vitest, In-Memory-DB-Muster `createInMemoryDatabase()` + `migrateDatabase(db)` + `createRepositories(db)`.
- Testlauf: `npx vitest run <pfad>` (einzelne Datei) bzw. `npx vitest run` (alle).

---

### Task 1: Schema-Migration + `mediaItemOverrides`-Repository

**Files:**
- Modify: `src/main/db/migrations.ts` (statements-Array, vor Zeile 240)
- Modify: `src/main/db/repositories.ts` (neues Repo-Objekt nach dem `mediaFiles`-Block, ~Zeile 590)
- Test: `tests/unit/media-overrides-repository.test.ts` (neu)

**Interfaces:**
- Produces:
  - `mediaItemOverrides.setExcluded({ kind: "series" | "movie"; arrId: number; excluded: boolean; note?: string | null; now: Date }): { ok: boolean; message: string }`
  - `mediaItemOverrides.isExcluded(mediaItemId: number): boolean`
  - `mediaItemOverrides.excludedItemIds(): number[]`

- [ ] **Step 1: Migration-Statement + Index ergänzen**

In `src/main/db/migrations.ts` im `statements`-Array direkt **vor** der schließenden `];` (vor Zeile 240, nach dem `automation_events`-Block bzw. nach den Index-Statements) zwei Einträge hinzufügen:

```ts
  `create table if not exists media_item_overrides (
    id integer primary key autoincrement,
    media_item_id integer not null references media_items(id) on delete cascade,
    is_excluded integer not null default 1,
    note text,
    created_at text not null,
    updated_at text not null,
    unique(media_item_id)
  )`,
  "create index if not exists idx_media_item_overrides_item on media_item_overrides(media_item_id)",
```

- [ ] **Step 2: Failing-Test schreiben**

Erstelle `tests/unit/media-overrides-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

function setupMovie(repos: ReturnType<typeof createRepositories>) {
  const instanceId = repos.instances.upsert({
    kind: "radarr",
    name: "Radarr",
    baseUrl: "http://radarr.local:7878",
    apiKeyEncrypted: "encrypted",
    enabled: true,
    now: new Date("2026-06-19T20:00:00.000Z"),
  });
  const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, {
    arrId: 201,
    kind: "movie",
    title: "Example Movie",
    titleSlug: undefined,
    sortTitle: undefined,
    year: 2024,
    monitored: true,
    hasFile: true,
    totalChildren: 1,
    childrenWithFile: 1,
    funChildren: 0,
    nonFunChildren: 1,
    totalSizeBytes: 4000,
    funSizeBytes: 0,
    funShare: 0,
    lastAnalyzedAt: "2026-06-19T20:00:00.000Z",
    qualityProfileName: undefined,
    files: [
      {
        arrFileId: 3001,
        childArrId: 201,
        isFun: false,
        path: "/movies/example.mkv",
        relativePath: "example.mkv",
        releaseGroup: "WvF",
        qualityName: "WEBDL-1080p",
        sizeBytes: 4000,
      },
    ],
  });
  return { instanceId, mediaItemId };
}

describe("mediaItemOverrides", () => {
  it("excludes an item, deletes its FuN candidates, and reports it excluded", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const { instanceId, mediaItemId } = setupMovie(repos);

    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 201,
      release: { guid: "c1", title: "Example.Movie.2024.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-19T20:05:00.000Z"),
    });

    const result = repos.mediaItemOverrides.setExcluded({
      kind: "movie",
      arrId: 201,
      excluded: true,
      now: new Date("2026-06-19T21:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(repos.mediaItemOverrides.isExcluded(mediaItemId)).toBe(true);
    expect(repos.mediaItemOverrides.excludedItemIds()).toEqual([mediaItemId]);
    expect(repos.mediaItems.itemDetails("movie", 201).candidates).toHaveLength(0);
  });

  it("re-includes an item without dropping the override row", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const { mediaItemId } = setupMovie(repos);

    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 201, excluded: true, now: new Date("2026-06-19T21:00:00.000Z") });
    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 201, excluded: false, now: new Date("2026-06-19T22:00:00.000Z") });

    expect(repos.mediaItemOverrides.isExcluded(mediaItemId)).toBe(false);
    expect(repos.mediaItemOverrides.excludedItemIds()).toEqual([]);
  });

  it("returns ok:false when the media item does not exist", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const result = repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 999, excluded: true, now: new Date() });
    expect(result.ok).toBe(false);
  });

  it("cascades the override away when the media item is removed", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const { mediaItemId } = setupMovie(repos);
    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 201, excluded: true, now: new Date() });

    db.prepare("delete from media_items where id = ?").run(mediaItemId);
    expect(repos.mediaItemOverrides.excludedItemIds()).toEqual([]);
  });
});
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/unit/media-overrides-repository.test.ts`
Expected: FAIL mit `repos.mediaItemOverrides is undefined` (bzw. TypeError beim Zugriff auf `setExcluded`).

- [ ] **Step 4: Repo implementieren**

In `src/main/db/repositories.ts` nach dem schließenden `},` des `mediaFiles`-Blocks (nach Zeile 590, vor `releaseCandidates: {`) einfügen:

```ts
    mediaItemOverrides: {
      setExcluded(input: {
        kind: "series" | "movie";
        arrId: number;
        excluded: boolean;
        note?: string | null;
        now: Date;
      }): { ok: boolean; message: string } {
        const item = db
          .prepare("select id from media_items where kind = ? and arr_id = ? order by id desc limit 1")
          .get(input.kind, input.arrId) as { id: number } | undefined;
        if (!item) {
          return { ok: false, message: "Media item not found" };
        }
        const now = toIso(input.now);
        const apply = db.transaction(() => {
          db.prepare(
            `insert into media_item_overrides (media_item_id, is_excluded, note, created_at, updated_at)
             values (?, ?, ?, ?, ?)
             on conflict(media_item_id) do update set
               is_excluded = excluded.is_excluded,
               updated_at = excluded.updated_at`,
          ).run(item.id, input.excluded ? 1 : 0, input.note ?? null, now, now);
          if (input.excluded) {
            db.prepare("delete from release_candidates where media_item_id = ?").run(item.id);
          }
        });
        apply();
        return { ok: true, message: input.excluded ? "Item excluded from automation and grabbing" : "Item override removed" };
      },

      isExcluded(mediaItemId: number): boolean {
        const row = db
          .prepare("select 1 as present from media_item_overrides where media_item_id = ? and is_excluded = 1")
          .get(mediaItemId) as { present: number } | undefined;
        return row !== undefined;
      },

      excludedItemIds(): number[] {
        const rows = db
          .prepare("select media_item_id as mediaItemId from media_item_overrides where is_excluded = 1")
          .all() as Array<{ mediaItemId: number }>;
        return rows.map((row) => row.mediaItemId);
      },
    },
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `npx vitest run tests/unit/media-overrides-repository.test.ts`
Expected: PASS (4 Tests grün).

- [ ] **Step 6: Commit**

```bash
git add src/main/db/migrations.ts src/main/db/repositories.ts tests/unit/media-overrides-repository.test.ts
git commit -m "feat: add media_item_overrides table and repository"
```

---

### Task 2: Pending-FuN-Lesepfade respektieren Overrides

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (`SonarrSeriesTableRow` Zeile 91-110, `RadarrMovieTableRow` Zeile 112-132)
- Modify: `src/main/db/repositories.ts` (`summary()` Zeile 201-210, `listSonarrRows()` Zeile 253-339, `listRadarrRows()` Zeile 341-442)
- Test: `tests/unit/media-overrides-queries.test.ts` (neu)

**Interfaces:**
- Consumes: `mediaItemOverrides` aus Task 1.
- Produces: `SonarrSeriesTableRow.isExcluded: boolean`, `RadarrMovieTableRow.isExcluded: boolean`. `summary()` zählt ausgenommene Items nicht in `sonarrPendingFunCandidates`/`radarrPendingFunCandidates`.

- [ ] **Step 1: Failing-Test schreiben**

Erstelle `tests/unit/media-overrides-queries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

function setupExcludedMovieWithCandidate() {
  const db = createInMemoryDatabase();
  migrateDatabase(db);
  const repos = createRepositories(db);
  const instanceId = repos.instances.upsert({
    kind: "radarr",
    name: "Radarr",
    baseUrl: "http://radarr.local:7878",
    apiKeyEncrypted: "encrypted",
    enabled: true,
    now: new Date("2026-06-19T20:00:00.000Z"),
  });
  const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, {
    arrId: 201,
    kind: "movie",
    title: "Example Movie",
    titleSlug: undefined,
    sortTitle: undefined,
    year: 2024,
    monitored: true,
    hasFile: true,
    totalChildren: 1,
    childrenWithFile: 1,
    funChildren: 0,
    nonFunChildren: 1,
    totalSizeBytes: 4000,
    funSizeBytes: 0,
    funShare: 0,
    lastAnalyzedAt: "2026-06-19T20:00:00.000Z",
    qualityProfileName: undefined,
    files: [
      { arrFileId: 3001, childArrId: 201, isFun: false, path: "/m/e.mkv", relativePath: "e.mkv", releaseGroup: "WvF", qualityName: "WEBDL-1080p", sizeBytes: 4000 },
    ],
  });
  // Candidate inserted BEFORE exclusion so the count query (not just the cleanup) is exercised.
  repos.releaseCandidates.insert({
    instanceId,
    mediaItemId,
    childArrId: 201,
    release: { guid: "c1", title: "Example.Movie.2024.FuN", releaseGroup: "FuN" },
    foundAt: new Date("2026-06-19T20:05:00.000Z"),
  });
  return { db, repos, mediaItemId };
}

describe("pending FuN queries with overrides", () => {
  it("flags excluded rows and drops them from pending counts", () => {
    const { repos, mediaItemId } = setupExcludedMovieWithCandidate();

    // Re-insert a candidate AFTER marking excluded via raw row, bypassing cleanup,
    // to prove the count query itself filters excluded items.
    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 201, excluded: true, now: new Date("2026-06-19T21:00:00.000Z") });
    repos.releaseCandidates.insert({
      instanceId: 1,
      mediaItemId,
      childArrId: 201,
      release: { guid: "c2", title: "Example.Movie.2024.FuN.PROPER", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-19T21:05:00.000Z"),
    });

    const radarrRows = repos.mediaItems.listRadarrRows();
    expect(radarrRows[0].isExcluded).toBe(true);
    expect(radarrRows[0].pendingFunCandidates).toBe(0);

    const summary = repos.mediaItems.summary();
    expect(summary.radarrPendingFunCandidates).toBe(0);
  });

  it("leaves non-excluded rows unaffected", () => {
    const { repos } = setupExcludedMovieWithCandidate();
    const radarrRows = repos.mediaItems.listRadarrRows();
    expect(radarrRows[0].isExcluded).toBe(false);
    expect(radarrRows[0].pendingFunCandidates).toBe(1);
    expect(repos.mediaItems.summary().radarrPendingFunCandidates).toBe(1);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/unit/media-overrides-queries.test.ts`
Expected: FAIL — `radarrRows[0].isExcluded` ist `undefined` (Property fehlt).

- [ ] **Step 3: Row-Typen erweitern**

In `src/shared/ipc-contracts.ts` beide Row-Typen um `isExcluded` ergänzen. In `SonarrSeriesTableRow` (nach `pendingFunCandidates: number;`, Zeile ~103):

```ts
  isExcluded: boolean;
```

In `RadarrMovieTableRow` (nach `pendingFunCandidates: number;`, Zeile ~125):

```ts
  isExcluded: boolean;
```

- [ ] **Step 4: `summary()` Pending-Query filtern**

In `src/main/db/repositories.ts` die Pending-Query in `summary()` (Zeile 201-210) ersetzen durch:

```ts
        const pending = db
          .prepare(
            `select
               coalesce(sum(case when mi.kind = 'series' then 1 else 0 end), 0) as sonarrPending,
               coalesce(sum(case when mi.kind = 'movie' then 1 else 0 end), 0) as radarrPending
             from release_candidates rc
             left join media_items mi on mi.id = rc.media_item_id
             left join media_item_overrides o on o.media_item_id = rc.media_item_id and o.is_excluded = 1
             where rc.is_fun = 1 and o.media_item_id is null`,
          )
          .get() as { sonarrPending: number; radarrPending: number };
```

- [ ] **Step 5: `listSonarrRows()` anpassen**

In `src/main/db/repositories.ts` in `listSonarrRows()`: die `pending_candidates`-CTE (Zeile 265-272) ersetzen durch eine override-bewusste Variante und im Haupt-SELECT ein `isExcluded`-Flag ergänzen.

CTE ersetzen:

```ts
             pending_candidates as (
               select
                 rc.media_item_id,
                 count(*) as pendingFunCandidates
               from release_candidates rc
               left join media_item_overrides o on o.media_item_id = rc.media_item_id and o.is_excluded = 1
               where rc.is_fun = 1 and o.media_item_id is null
               group by rc.media_item_id
             )
```

Im Haupt-SELECT nach `coalesce(pc.pendingFunCandidates, 0) as pendingFunCandidates,` (Zeile 288) ergänzen:

```ts
               case when ovr.media_item_id is not null then 1 else 0 end as isExcluded,
```

Nach `left join pending_candidates pc on pc.media_item_id = mi.id` (Zeile 293) ergänzen:

```ts
             left join media_item_overrides ovr on ovr.media_item_id = mi.id and ovr.is_excluded = 1
```

Im Row-Typ der `.all()`-Annotation (nach `pendingFunCandidates: number;`, Zeile 312) ergänzen:

```ts
          isExcluded: 0 | 1;
```

Im `rows.map(...)`-Rückgabeobjekt (nach `pendingFunCandidates: row.pendingFunCandidates,`, Zeile 330) ergänzen:

```ts
            isExcluded: Boolean(row.isExcluded),
```

- [ ] **Step 6: `listRadarrRows()` anpassen**

Analog in `listRadarrRows()`. `pending_candidates`-CTE (Zeile 353-359) ersetzen durch:

```ts
             pending_candidates as (
               select
                 rc.media_item_id,
                 count(*) as pendingFunCandidates
               from release_candidates rc
               left join media_item_overrides o on o.media_item_id = rc.media_item_id and o.is_excluded = 1
               where rc.is_fun = 1 and o.media_item_id is null
               group by rc.media_item_id
             ),
```

Im Haupt-SELECT nach `coalesce(pc.pendingFunCandidates, 0) as pendingFunCandidates,` (Zeile 384) ergänzen:

```ts
               case when ovr.media_item_id is not null then 1 else 0 end as isExcluded,
```

Nach `left join first_file ff on ff.media_item_id = mi.id` (Zeile 393) ergänzen:

```ts
             left join media_item_overrides ovr on ovr.media_item_id = mi.id and ovr.is_excluded = 1
```

Im Row-Typ der `.all()`-Annotation (nach `pendingFunCandidates: number;`, Zeile 411) ergänzen:

```ts
          isExcluded: 0 | 1;
```

Im `rows.map(...)`-Rückgabeobjekt (nach `pendingFunCandidates: row.pendingFunCandidates,`, Zeile 432) ergänzen:

```ts
            isExcluded: Boolean(row.isExcluded),
```

- [ ] **Step 7: Test ausführen — muss bestehen**

Run: `npx vitest run tests/unit/media-overrides-queries.test.ts`
Expected: PASS (2 Tests grün).

- [ ] **Step 8: Bestehende Repo-Tests prüfen**

Run: `npx vitest run tests/unit/repositories.test.ts`
Expected: PASS — bestehende `expect.objectContaining(...)`-Assertions bleiben gültig (neues Feld `isExcluded` stört `objectContaining` nicht).

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc-contracts.ts src/main/db/repositories.ts tests/unit/media-overrides-queries.test.ts
git commit -m "feat: exclude overridden items from pending FuN counts and table rows"
```

---

### Task 3: Automation-Reconcile schließt ausgenommene Items aus

**Files:**
- Modify: `src/main/automation/automation-types.ts` (`AutomationMediaFile` Zeile 11-33)
- Modify: `src/main/db/repositories.ts` (`listForAutomation` Query Zeile 547-586, Typen `AutomationMediaFileView` Zeile 1675-1697, `AutomationMediaFileRow` Zeile 1699-1703, `formatAutomationMediaFileRow` Zeile 1705+)
- Modify: `src/main/automation/filtering.ts` (`matchesAutomationFilters` Zeile 6-20)
- Modify: `tests/unit/automation-filtering.test.ts` (Helper `mediaFile` Zeile 129+)
- Test: `tests/unit/automation-filtering.test.ts` (neuer Testfall)

**Interfaces:**
- Consumes: `media_item_overrides`-Tabelle aus Task 1.
- Produces: `AutomationMediaFile.isExcluded: boolean`; `matchesAutomationFilters` gibt `false` für ausgenommene Items zurück.

- [ ] **Step 1: Failing-Test schreiben**

In `tests/unit/automation-filtering.test.ts` einen Testfall innerhalb des bestehenden `describe`-Blocks ergänzen (vor der schließenden `});` bei Zeile 127):

```ts
  it("excludes overridden media items regardless of other filters", () => {
    const filters: AutomationGoalFilters = {
      monitored: "either",
      hasFile: "either",
      qualityProfiles: [],
      funShare: null,
      analyzed: { mode: "any" },
      searched: { mode: "any" },
      grabbed: { mode: "any" },
    };
    expect(matchesAutomationFilters(mediaFile({ isExcluded: true }), filters, now)).toBe(false);
    expect(matchesAutomationFilters(mediaFile({ isExcluded: false }), filters, now)).toBe(true);
  });
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/unit/automation-filtering.test.ts`
Expected: FAIL — Typfehler/Compile-Fehler, weil `isExcluded` weder im Typ `AutomationMediaFile` noch im Helper existiert (bzw. Assertion `false` schlägt fehl, sobald der Helper erweitert ist aber der Filter noch nicht).

- [ ] **Step 3: Typ `AutomationMediaFile` erweitern**

In `src/main/automation/automation-types.ts` im Typ `AutomationMediaFile` nach `hasFile: boolean;` (Zeile 27) ergänzen:

```ts
  isExcluded: boolean;
```

- [ ] **Step 4: Test-Helper erweitern**

In `tests/unit/automation-filtering.test.ts` im Helper `mediaFile` (Zeile 130+, im Default-Objekt) nach `hasFile: true,` (bzw. der entsprechenden Zeile) ergänzen:

```ts
    isExcluded: false,
```

- [ ] **Step 5: `matchesAutomationFilters` erweitern**

In `src/main/automation/filtering.ts` die Funktion (Zeile 11-20) anpassen — als erste Bedingung den Ausschluss einfügen:

```ts
  return (
    !file.isExcluded &&
    matchesTriState(file.monitored, filters.monitored) &&
    matchesTriState(file.hasFile, filters.hasFile) &&
    matchesQualityProfile(file.qualityProfileName, filters.qualityProfiles) &&
    matchesFunShare(file.itemFunShare, filters.funShare) &&
    matchesRecency(file.lastAnalyzedAt, filters.analyzed, now) &&
    matchesRecency(file.lastSearchedAt, filters.searched, now) &&
    matchesRecency(file.lastGrabbedAt, filters.grabbed, now)
  );
```

- [ ] **Step 6: View-/Row-Typen + Formatter in repositories.ts erweitern**

In `src/main/db/repositories.ts`:

`AutomationMediaFileView` (Zeile 1675-1697) nach `hasFile: boolean;` ergänzen:

```ts
  isExcluded: boolean;
```

`AutomationMediaFileRow` (Zeile 1699-1703) — der `Omit<...>` listet die zu 0|1 umgewandelten Felder. Ergänze `isExcluded` zur Omit-Liste und zum 0|1-Block:

```ts
type AutomationMediaFileRow = Omit<AutomationMediaFileView, "isFun" | "monitored" | "hasFile" | "isExcluded"> & {
  isFun: 0 | 1;
  monitored: 0 | 1;
  hasFile: 0 | 1;
  isExcluded: 0 | 1;
};
```

`formatAutomationMediaFileRow` (Zeile 1705+) im Rückgabeobjekt nach `isFun: Boolean(row.isFun),` ergänzen:

```ts
    isExcluded: Boolean(row.isExcluded),
```

- [ ] **Step 7: `listForAutomation`-Query erweitern**

In `src/main/db/repositories.ts` in `listForAutomation` (Query ab Zeile 534): im SELECT nach `mi.has_file as hasFile,` (Zeile 571) ergänzen:

```ts
               case when ovr.media_item_id is not null then 1 else 0 end as isExcluded,
```

Nach dem `left join last_activity la ...`-Block (nach Zeile 582, vor `where (? = 'both' or i.kind = ?)`) ergänzen:

```ts
             left join media_item_overrides ovr on ovr.media_item_id = mi.id and ovr.is_excluded = 1
```

- [ ] **Step 8: Test ausführen — muss bestehen**

Run: `npx vitest run tests/unit/automation-filtering.test.ts`
Expected: PASS (inkl. neuem Testfall).

- [ ] **Step 9: Automation-Reconcile-Tests prüfen**

Run: `npx vitest run tests/unit/automation-runner.test.ts tests/unit/automation-repositories.test.ts`
Expected: PASS. Falls ein bestehender Test ein `AutomationMediaFile`/Row-Objekt literal konstruiert, dort `isExcluded: false` bzw. `isExcluded: 0` ergänzen (gleiche Stelle wie die anderen Flags) und erneut ausführen.

- [ ] **Step 10: Commit**

```bash
git add src/main/automation/automation-types.ts src/main/automation/filtering.ts src/main/db/repositories.ts tests/unit/automation-filtering.test.ts
git commit -m "feat: skip excluded items in automation reconcile and filtering"
```

---

### Task 4: IPC-Channel `media:setOverride`

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (`IpcChannel` Zeile 5-44, neuer Input-Typ bei den Action-Inputs ~Zeile 46-52)
- Modify: `src/main/ipc.ts` (Handler-Registrierung bei den `media`/`library`-Handlern, neue `assertMediaOverrideInput`-Funktion bei den anderen `assert…`-Funktionen ~Zeile 1470+)
- Modify: `src/renderer/state/ipc-client.ts` (neue `setMediaOverride`-Funktion ~Zeile 136+)
- Test: `tests/unit/media-override-input.test.ts` (neu)

**Interfaces:**
- Consumes: `mediaItemOverrides.setExcluded` aus Task 1.
- Produces:
  - Channel `"media:setOverride"`.
  - `MediaOverrideInput = { kind: "series" | "movie"; arrId: number; excluded: boolean; note?: string }`.
  - `assertMediaOverrideInput(payload: unknown): MediaOverrideInput` (export für Test).
  - Renderer-Client `setMediaOverride(input: MediaOverrideInput): Promise<ArrActionResult>`.

- [ ] **Step 1: Failing-Test für Validierung schreiben**

Erstelle `tests/unit/media-override-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertMediaOverrideInput } from "../../src/main/ipc";

describe("assertMediaOverrideInput", () => {
  it("accepts a valid movie exclusion payload", () => {
    expect(assertMediaOverrideInput({ kind: "movie", arrId: 201, excluded: true })).toEqual({
      kind: "movie",
      arrId: 201,
      excluded: true,
      note: undefined,
    });
  });

  it("rejects an invalid kind", () => {
    expect(() => assertMediaOverrideInput({ kind: "album", arrId: 1, excluded: true })).toThrow();
  });

  it("rejects a non-positive arrId", () => {
    expect(() => assertMediaOverrideInput({ kind: "series", arrId: 0, excluded: true })).toThrow();
  });

  it("rejects a non-boolean excluded flag", () => {
    expect(() => assertMediaOverrideInput({ kind: "series", arrId: 5, excluded: "yes" })).toThrow();
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/unit/media-override-input.test.ts`
Expected: FAIL — `assertMediaOverrideInput` ist kein Export von `ipc.ts`.

- [ ] **Step 3: Channel + Input-Typ ergänzen**

In `src/shared/ipc-contracts.ts` in der `IpcChannel`-Union (Zeile 5-44) nach `| "library:itemDetails"` ergänzen:

```ts
  | "media:setOverride"
```

Bei den Action-Input-Typen (nach `RadarrMovieActionInput`, ~Zeile 52) ergänzen:

```ts
export type MediaOverrideInput = {
  kind: "series" | "movie";
  arrId: number;
  excluded: boolean;
  note?: string;
};
```

- [ ] **Step 4: `assertMediaOverrideInput` + Handler implementieren**

In `src/main/ipc.ts`: zuerst den Import von `MediaOverrideInput` und `ArrActionResult` sicherstellen (zur bestehenden Import-Liste aus `../shared/ipc-contracts` hinzufügen, falls noch nicht vorhanden).

Bei den anderen `assert…`-Funktionen (z. B. nach `assertMovieActionInput`, ~Zeile 1494) ergänzen:

```ts
export function assertMediaOverrideInput(payload: unknown): MediaOverrideInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid media override payload");
  }
  const value = payload as Partial<MediaOverrideInput>;
  if (value.kind !== "series" && value.kind !== "movie") {
    throw new Error("Invalid media override kind");
  }
  if (!Number.isInteger(value.arrId) || Number(value.arrId) <= 0) {
    throw new Error("Invalid media override arrId");
  }
  if (typeof value.excluded !== "boolean") {
    throw new Error("Invalid media override excluded flag");
  }
  if (value.note !== undefined && typeof value.note !== "string") {
    throw new Error("Invalid media override note");
  }
  return { kind: value.kind, arrId: value.arrId, excluded: value.excluded, note: value.note };
}
```

Den Handler bei den anderen `ipcMain.handle(...)`-Registrierungen (z. B. nach `"library:itemDetails"`) ergänzen:

```ts
  ipcMain.handle("media:setOverride", (_event, payload: unknown): ArrActionResult => {
    const input = assertMediaOverrideInput(payload);
    const result = state.repositories.mediaItemOverrides.setExcluded({ ...input, now: new Date() });
    return { ok: result.ok, message: result.message };
  });
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `npx vitest run tests/unit/media-override-input.test.ts`
Expected: PASS (4 Tests grün).

- [ ] **Step 6: Renderer-Client-Funktion ergänzen**

In `src/renderer/state/ipc-client.ts` den Typ-Import um `MediaOverrideInput` und `ArrActionResult` erweitern (zur bestehenden Import-Liste aus `../../shared/ipc-contracts`) und nach `grabRadarrMovies` (~Zeile 146) ergänzen:

```ts
export function setMediaOverride(input: MediaOverrideInput): Promise<ArrActionResult> {
  return invokeIpc<ArrActionResult>("media:setOverride", input);
}
```

- [ ] **Step 7: Typecheck/Build prüfen**

Run: `npx tsc --noEmit`
Expected: Keine Fehler.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc-contracts.ts src/main/ipc.ts src/renderer/state/ipc-client.ts tests/unit/media-override-input.test.ts
git commit -m "feat: add media:setOverride IPC channel and client"
```

---

### Task 5: Manuelle Such-/Grab-Jobs überspringen ausgenommene Items

**Files:**
- Create: `src/main/media-overrides.ts`
- Modify: `src/main/ipc.ts` (`searchSonarrCandidates`, `searchRadarrCandidates`, `grabSonarrCandidates`, `grabRadarrCandidates`)
- Test: `tests/unit/media-overrides-filter.test.ts` (neu)

**Interfaces:**
- Consumes: `mediaItemOverrides.excludedItemIds()` aus Task 1.
- Produces: `filterOutExcluded<T>(items: T[], excludedItemIds: Set<number>, getMediaItemId: (item: T) => number | null | undefined): T[]`.

- [ ] **Step 1: Failing-Test schreiben**

Erstelle `tests/unit/media-overrides-filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterOutExcluded } from "../../src/main/media-overrides";

describe("filterOutExcluded", () => {
  const items = [
    { id: "a", mediaItemId: 1 },
    { id: "b", mediaItemId: 2 },
    { id: "c", mediaItemId: null },
    { id: "d", mediaItemId: undefined },
  ];

  it("removes items whose mediaItemId is excluded", () => {
    const result = filterOutExcluded(items, new Set([2]), (item) => item.mediaItemId);
    expect(result.map((item) => item.id)).toEqual(["a", "c", "d"]);
  });

  it("keeps everything when nothing is excluded", () => {
    const result = filterOutExcluded(items, new Set<number>(), (item) => item.mediaItemId);
    expect(result).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/unit/media-overrides-filter.test.ts`
Expected: FAIL — Modul `src/main/media-overrides.ts` existiert nicht.

- [ ] **Step 3: Helper implementieren**

Erstelle `src/main/media-overrides.ts`:

```ts
export function filterOutExcluded<T>(
  items: T[],
  excludedItemIds: Set<number>,
  getMediaItemId: (item: T) => number | null | undefined,
): T[] {
  if (excludedItemIds.size === 0) {
    return items;
  }
  return items.filter((item) => {
    const mediaItemId = getMediaItemId(item);
    return mediaItemId == null || !excludedItemIds.has(mediaItemId);
  });
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `npx vitest run tests/unit/media-overrides-filter.test.ts`
Expected: PASS (2 Tests grün).

- [ ] **Step 5: Helper in den Such-/Grab-Pfaden anwenden**

In `src/main/ipc.ts` den Import ergänzen (bei den übrigen `../`-Imports):

```ts
import { filterOutExcluded } from "./media-overrides";
```

**`searchSonarrCandidates`:** Direkt nach `const episodeTasks = seriesEpisodes.flat();` einfügen:

```ts
    const excludedIds = new Set(state.repositories.mediaItemOverrides.excludedItemIds());
    const allowedEpisodeTasks = filterOutExcluded(episodeTasks, excludedIds, (task) => task.mediaItemId);
    if (allowedEpisodeTasks.length < episodeTasks.length) {
      context.addEvent("info", `Skipping ${episodeTasks.length - allowedEpisodeTasks.length} episode(s) from excluded series`);
    }
```

Anschließend jede weitere Verwendung von `episodeTasks` in dieser Funktion (z. B. `context.setProgressTotal(...)` und das `mapConcurrent(episodeTasks, ...)`) auf `allowedEpisodeTasks` umstellen.

**`searchRadarrCandidates`:** Direkt nach der `const movieTasks = ...`-Zuweisung einfügen:

```ts
    const excludedIds = new Set(state.repositories.mediaItemOverrides.excludedItemIds());
    const allowedMovieTasks = filterOutExcluded(movieTasks, excludedIds, (task) => task.mediaItemId);
    if (allowedMovieTasks.length < movieTasks.length) {
      context.addEvent("info", `Skipping ${movieTasks.length - allowedMovieTasks.length} excluded movie(s)`);
    }
```

Anschließend `context.setProgressTotal(movieTasks.length)` und `mapConcurrent(movieTasks, ...)` auf `allowedMovieTasks` umstellen.

**`grabSonarrCandidates`:** Die Zeile `const candidates = state.repositories.releaseCandidates.listForSeriesIds(input.seriesIds);` ersetzen durch:

```ts
    const excludedIds = new Set(state.repositories.mediaItemOverrides.excludedItemIds());
    const candidates = filterOutExcluded(
      state.repositories.releaseCandidates.listForSeriesIds(input.seriesIds),
      excludedIds,
      (candidate) => candidate.mediaItemId,
    );
```

**`grabRadarrCandidates`:** Die Zeile `const candidates = state.repositories.releaseCandidates.listForMovieIds(input.movieIds);` ersetzen durch:

```ts
    const excludedIds = new Set(state.repositories.mediaItemOverrides.excludedItemIds());
    const candidates = filterOutExcluded(
      state.repositories.releaseCandidates.listForMovieIds(input.movieIds),
      excludedIds,
      (candidate) => candidate.mediaItemId,
    );
```

> Hinweis: Falls `listForSeriesIds`/`listForMovieIds` ein Element ohne `mediaItemId`-Feld liefern, prüfe den Rückgabetyp in `repositories.ts` — das Feld heißt dort `mediaItemId` (siehe `grabStoredCandidates`, das `candidate.mediaItemId` nutzt). Der Selector bleibt `(candidate) => candidate.mediaItemId`.

- [ ] **Step 6: Typecheck + Gesamttests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Keine Typfehler; alle Tests grün.

- [ ] **Step 7: Commit**

```bash
git add src/main/media-overrides.ts src/main/ipc.ts tests/unit/media-overrides-filter.test.ts
git commit -m "feat: skip excluded items in manual search and grab jobs"
```

---

### Task 6: Renderer — Badge, Toggle-Aktion, Bulk-Aktion, Sichtbarkeits-Filter

**Files:**
- Modify: `src/renderer/App.tsx` (`runSetOverride`-Handler + Props an Views)
- Modify: `src/renderer/views/RadarrMoviesView.tsx` (Props, Override-Spalte, Actions-Spalte, Bulk-Aktion, Sichtbarkeits-Filter)
- Modify: `src/renderer/views/SonarrSeriesView.tsx` (analog)

**Interfaces:**
- Consumes: `setMediaOverride` aus Task 4; `RadarrMovieTableRow.isExcluded` / `SonarrSeriesTableRow.isExcluded` aus Task 2.
- Produces: Views erhalten Prop `onSetOverride?: (arrId: number, excluded: boolean) => void`.

> Hinweis: Dieser Task ist UI-Verdrahtung ohne Unit-Test (die Views haben keine bestehende Test-Suite). Verifikation erfolgt über `tsc --noEmit` und einen manuellen Smoke-Test am Ende.

- [ ] **Step 1: `App.tsx` — Handler + Import**

In `src/renderer/App.tsx` den Import aus dem ipc-client um `setMediaOverride` erweitern. Nach `runSonarrGrab` (~Zeile 210) den Handler ergänzen:

```ts
  async function runSetOverride(kind: "series" | "movie", arrId: number, excluded: boolean) {
    try {
      await setMediaOverride({ kind, arrId, excluded });
      if (kind === "movie") {
        await refreshRadarrRows();
      } else {
        await refreshSonarrRows();
      }
      void refreshKpis();
    } catch (error) {
      if (kind === "movie") {
        setRadarrStatus(error instanceof Error ? error.message : String(error));
      } else {
        setSonarrStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }
```

- [ ] **Step 2: `App.tsx` — Prop an Views durchreichen**

Bei der Verwendung von `<RadarrMoviesView ... />` ergänzen:

```tsx
        onSetOverride={(arrId, excluded) => void runSetOverride("movie", arrId, excluded)}
```

Bei `<SonarrSeriesView ... />` ergänzen:

```tsx
        onSetOverride={(arrId, excluded) => void runSetOverride("series", arrId, excluded)}
```

- [ ] **Step 3: `RadarrMoviesView.tsx` — Props + Icon-Import**

Den lucide-Import (Zeile 3) um `Ban` und `ShieldOff` erweitern:

```ts
import { Ban, ExternalLink, Eye, Play, Radar, Search, ShieldOff, Zap } from "lucide-react";
```

Im Props-Objekt (Zeile 34-56) `onSetOverride` ergänzen — bei den Funktions-Props und im Typ:

```ts
  onSetOverride,
```

und im Typ-Block:

```ts
  onSetOverride?: (arrId: number, excluded: boolean) => void;
```

- [ ] **Step 4: `RadarrMoviesView.tsx` — Override-Badge-Spalte + Toggle-Aktion**

In der `columns`-Definition vor der `actions`-Spalte (vor dem letzten Eintrag, ~Zeile 184) eine Override-Spalte einfügen:

```ts
      {
        accessorKey: "isExcluded",
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <span className="inline-flex h-[22px] items-center justify-center rounded-md border border-signal-amber/25 bg-signal-amber/[0.10] px-1.5 text-[12px] font-semibold text-signal-amber">
              Override
            </span>
          ) : (
            <span className="font-mono text-[13px] tabular-nums text-ink-600">—</span>
          ),
        filterFn: booleanFilter,
        header: "Override",
        size: 104,
      },
```

In der `actions`-Spalte (Zeile 185-195) den `<div>`-Inhalt um einen Toggle-Button erweitern (nach dem ExternalLink-Button):

```tsx
            <IconButton
              className="px-2"
              icon={row.original.isExcluded ? ShieldOff : Ban}
              label={row.original.isExcluded ? `Re-include ${row.original.title}` : `Exclude ${row.original.title} from grabbing`}
              onClick={() => onSetOverride?.(row.original.arrId, !row.original.isExcluded)}
              tone={row.original.isExcluded ? "warning" : "default"}
            />
```

Das `useMemo`-Dependency-Array der `columns` (Zeile 205, aktuell `[onOpenInRadarr]`) auf `[onOpenInRadarr, onSetOverride]` erweitern.

- [ ] **Step 5: `RadarrMoviesView.tsx` — Bulk-Aktion + Sichtbarkeits-Filter**

Am Anfang der Komponente (bei den anderen Hooks, vor `columns`) einen lokalen State ergänzen:

```ts
  const [hideOverrides, setHideOverrides] = useState(false);
```

(`useState` ist in dieser Datei bereits importiert.) Die Daten, die an `data={rows}` übergeben werden, vorab filtern — direkt vor dem `return`/JSX eine abgeleitete Variable bilden:

```ts
  const visibleRows = hideOverrides ? rows.filter((row) => !row.isExcluded) : rows;
```

und `data={rows}` (Zeile ~246) durch `data={visibleRows}` ersetzen.

In `bulkActions` (Zeile 220-244) nach dem "Grab selected"-Button (vor dem Separator) einen Override-Bulk-Button ergänzen:

```tsx
            <IconButton
              icon={Ban}
              label="Exclude selected Radarr movies from grabbing"
              onClick={() => selectedRows.forEach((row) => onSetOverride?.(row.original.arrId, true))}
            >
              Exclude selected
            </IconButton>
```

Für den Sichtbarkeits-Toggle die `FilterChip`-Komponente verwenden. `FilterChip` wird aus `SonarrSeriesView` exportiert — Import oben in `RadarrMoviesView.tsx` ergänzen:

```ts
import { FilterChip } from "./SonarrSeriesView";
```

Den Chip in die bestehende `filters`-Toolbar des DataTable einhängen. Die View übergibt `filters={filterControls}` an `<DataTable>`. Ergänze in dem JSX-Fragment, das `filterControls` bildet, als zusätzliches Element:

```tsx
        <FilterChip active={hideOverrides} label={hideOverrides ? "Overrides hidden" : "Hide overrides"} onClick={() => setHideOverrides((value) => !value)} />
```

> Falls `filterControls` in dieser Datei nicht existiert oder anders heißt, folge dem Muster aus `SonarrSeriesView.tsx` (dort wird `filterControls` als JSX gebildet und an `filters` übergeben) und füge den `FilterChip` dort an.

- [ ] **Step 6: `SonarrSeriesView.tsx` — analoge Änderungen**

Icon-Import (Zeile mit lucide-Imports) um `Ban` und `ShieldOff` erweitern.

Props (Zeile 25-47): `onSetOverride` als Prop + Typ ergänzen (wie in Step 3).

Override-Spalte vor der `actions`-Spalte einfügen (identischer Code wie Step 4, Override-Spalte).

Toggle-Button in der `actions`-Spalte ergänzen (wie Step 4) — `onOpenInSonarr` bleibt unverändert; `useMemo`-Dependency-Array (Zeile 205, aktuell `[onOpenInSonarr]`) auf `[onOpenInSonarr, onSetOverride]` erweitern.

Lokalen State `hideOverrides` ergänzen; die an `data={resolvedRows}` (Zeile ~234) übergebenen Zeilen vorab filtern:

```ts
  const visibleRows = hideOverrides ? resolvedRows.filter((row) => !row.isExcluded) : resolvedRows;
```

und `data={resolvedRows}` durch `data={visibleRows}` ersetzen.

Bulk-Aktion "Exclude selected" in `bulkActions` ergänzen (wie Step 5).

`FilterChip` ist in dieser Datei bereits definiert (Zeile 468) — kein Import nötig. Den Chip in `filterControls` einhängen (wie Step 5, ohne Import).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: Keine Fehler.

- [ ] **Step 8: Smoke-Test (manuell)**

Run: `npm run dev` (oder projektüblicher Dev-Start). Prüfe in der Radarr-Tabelle:
- Toggle-Aktion in einer Zeile setzt "Override"-Badge, Pending-FuN-Spalte geht auf 0, KPI "Radarr FuN* … pending" sinkt.
- "Hide overrides"-Chip blendet ausgenommene Zeilen aus.
- "Exclude selected" über Mehrfachauswahl nimmt alle gewählten aus.
- Erneuter Toggle (ShieldOff) hebt die Ausnahme auf.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/App.tsx src/renderer/views/RadarrMoviesView.tsx src/renderer/views/SonarrSeriesView.tsx
git commit -m "feat: add override badge, toggle, bulk action and visibility filter to library tables"
```

---

## Self-Review-Ergebnis

- **Spec-Abdeckung:** Datenmodell (Task 1), Pending-FuN-Ausschluss + Anzeige-Flag (Task 2), Automation-Ausschluss (Task 3), IPC (Task 4), manuelles Grab-/Such-Blocking (Task 5), UI inkl. Badge/Toggle/Bulk/Filter (Task 6), Kandidaten-Cleanup beim Ausnehmen (Task 1), nur-bei-`excluded:true`-Cleanup (Task 1). Alle Spec-Abschnitte sind abgedeckt.
- **Typkonsistenz:** `isExcluded` durchgängig; `setExcluded`/`excludedItemIds`/`isExcluded` Signaturen über Tasks 1/2/3/4/5 identisch verwendet; `filterOutExcluded`-Selektor konsistent `(x) => x.mediaItemId`.
- **Tests:** Repo (Task 1), Queries (Task 2), Filter (Task 3+5), IPC-Validierung (Task 4). UI ohne Unit-Test (kein bestehendes Setup) — bewusst per Smoke-Test verifiziert.
