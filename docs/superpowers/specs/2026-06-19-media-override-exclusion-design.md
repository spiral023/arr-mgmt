# Design: Globale Item-Overrides (Ausnehmen von Grab & Pending FuN)

**Datum:** 2026-06-19
**Status:** Freigegeben (Design)

## Problem

Nutzer wollen einzelne Medien-Elemente global "ausnehmen" können, sodass sie:

- nicht mehr gegrabbt werden (Automation **und** manuell),
- nicht mehr als "Pending FuN" gezählt/angezeigt werden,
- stattdessen als **Override** gekennzeichnet bleiben,
- und dieser Ausschluss überall in der App respektiert wird.

Hintergrund: In der Library gibt es viele Filme/Serien, die nie eine FuN-Version
bekommen sollen. Diese erzeugen dauerhaft Such-/Grab-Last und verfälschen die
Pending-FuN-Kennzahlen.

## Entscheidungen (aus Brainstorming)

| Frage | Entscheidung |
|---|---|
| Granularität | **Item-Ebene**: Radarr-Film oder ganze Sonarr-Serie. Eine ausgenommene Serie nimmt alle Episoden mit. |
| Anzeige | Ausgenommene Elemente **bleiben sichtbar**, als «Override» markiert, fallen aus der Pending-FuN-Zählung, per Filter ein-/ausblendbar. |
| Manueller Grab/Suche | **Hart blockieren** (mit Hinweis im Job-Ergebnis). |
| Bestehende FuN-Kandidaten | **Beim Ausnehmen löschen** (analog zum bestehenden Cleanup). |
| Datenmodell | **Separate Tabelle** `media_item_overrides` (Ansatz B). |

## Datenmodell

Neue Tabelle, ergänzt in `src/main/db/migrations.ts` im CREATE-TABLE-Block (Muster
wie bestehende Tabellen, `create table if not exists`):

```sql
create table if not exists media_item_overrides (
  id integer primary key autoincrement,
  media_item_id integer not null references media_items(id) on delete cascade,
  is_excluded integer not null default 1,
  note text,
  created_at text not null,
  updated_at text not null,
  unique(media_item_id)
);
create index if not exists idx_media_item_overrides_item on media_item_overrides(media_item_id);
```

- `is_excluded` als explizites Flag (statt bloßer Zeilenexistenz), um künftig
  feingranulare Override-Arten zu ermöglichen (z. B. nur Automation ausnehmen).
- `note` optional, im Schema vorhanden, in dieser Version nicht zwingend in der UI befüllt.
- `on delete cascade`: Override verschwindet automatisch, wenn der Film/die Serie aus
  der Library entfernt wird.
- Override hängt an `media_items` → wirkt für Filme (1 Item) wie für Serien (Item +
  alle zugehörigen `media_files`/Episoden).

## Repository-Schicht

Neues `mediaItemOverrides`-Repo in `src/main/db/repositories.ts`:

- `setExcluded({ kind, arrId, excluded, note?, now })`:
  - mappt `(kind, arrId)` → `media_item_id`,
  - upsertet den Override (`on conflict(media_item_id) do update`), wobei `excluded:true`
    `is_excluded = 1` setzt und `excluded:false` `is_excluded = 0` (Zeile bleibt erhalten,
    behält `created_at`/`note`),
  - **nur bei `excluded:true`: löscht in derselben Transaktion die zugehörigen
    `release_candidates`** des Items (gleiches Muster wie der bestehende Cleanup bei
    `repositories.ts:163-170`),
  - gibt Erfolg/Fehler (Item nicht gefunden) zurück.
- `excludedItemIds()` bzw. ein Helfer für die Query-Joins/Tests.

Ggf. kleiner Helfer `mediaItems.findId(kind, arrId)`, falls noch nicht vorhanden.

## Betroffene Queries (Override respektieren)

Jeweils `LEFT JOIN media_item_overrides o on o.media_item_id = mi.id and o.is_excluded = 1`
plus Filter bzw. ausgegebenes Flag:

1. **Pending-FuN-KPIs** — `summary()` (`repositories.ts:200-210`): ausgenommene Items
   aus der Zählung der Pending-FuN-Kandidaten ausschließen.
2. **Sonarr-Tabelle** — `pendingFunCandidates`-CTE (`repositories.ts:265-272`):
   ausgenommene zählen 0; zusätzlich neues Feld `isExcluded` pro Zeile.
3. **Radarr-Tabelle** — `pendingFunCandidates`-CTE (`repositories.ts:353-359`): analog,
   inkl. `isExcluded` pro Zeile.
4. **Automation** — `listForAutomation()` (`repositories.ts:532-589`) liefert `isExcluded`
   pro Zeile; in `src/main/automation/filtering.ts` greift ein expliziter Ausschluss,
   sodass ausgenommene Items **gar nicht erst zu Work-Items** werden (`reconcileGoal`).

Das `AutomationMediaFile`-Typobjekt (`src/main/automation/automation-types.ts`) erhält
ein Feld `isExcluded: boolean`.

## Grab-/Such-Blocking (hart)

- **Automation:** bereits durch den Reconcile-Ausschluss abgedeckt — ausgenommene Items
  werden keine Work-Items, also weder gesucht noch gegrabbt.
- **Manuell:** in den Such-/Grab-Job-Funktionen (`searchSonarrCandidates`/
  `searchRadarrCandidates` und die Grab-Pfade um `ipc.ts:1100-1200`, sowie
  `sonarr:grab`/`radarr:grab`) ein Guard **vor** Such- und Grab-Aktion: ausgenommene
  Items werden übersprungen und im Job-Event/Ergebnis als `skipped: excluded` vermerkt.

## IPC & Contracts

Neuer Channel `media:setOverride`:

- Vertrag in `src/shared/ipc-contracts.ts` (Channel-Name + Input/Output-Typen).
- Handler in `src/main/ipc.ts` (Muster wie `automation:saveGoal`):
  - Input `{ kind: "movie" | "series", arrId: number, excluded: boolean, note?: string }`,
    validiert per `assertMediaOverrideInput`-Funktion.
  - Rückgabe `ArrActionResult` (`{ ok, message }`).
- Renderer ruft `window.arrOps.invoke("media:setOverride", payload)` und lädt danach
  Tabelle + Summary neu.

## UI/Renderer

In `src/renderer/views/SonarrSeriesView.tsx` und `RadarrMoviesView.tsx`:

- **Override-Badge:** Status-Chip in ausgenommenen Zeilen; die Pending-FuN-Spalte zeigt
  für ausgenommene Items nichts an (kommt bereits aus der Query mit 0).
- **Zeilen-Aktion:** IconButton (z. B. Ban-Icon) als Toggle „Ausnehmen" / „Wieder
  aufnehmen" in der Actions-Spalte (`SonarrSeriesView.tsx:184-202` und Radarr-Analogon).
- **Bulk-Aktion:** die vorhandene Zeilen-Selektion (Checkbox-Spalte) nutzen, um mehrere
  Items auf einmal auszunehmen.
- **Filter-Toggle:** in der sticky KPI-/Menüleiste ein Toggle „Overrides ein-/ausblenden"
  (Default: eingeblendet).

## Tests

Unit-Tests (Vitest, `tests/unit/`):

- **Override-Repo:** `setExcluded` upsertet korrekt, löscht zugehörige
  `release_candidates`, Cascade-Delete beim Entfernen des `media_items`.
- **Automation:** `listForAutomation`/`filtering` — ein ausgenommenes Item erscheint
  nicht als Work-Item; nach Aufheben des Overrides wieder.
- **Pending-FuN-Queries:** `summary`, Sonarr-/Radarr-Listen — ausgenommene Items zählen
  nicht als Pending FuN und tragen das Flag `isExcluded`.
- **Manuelle Grab-Pfade:** ausgenommenes Item wird bei Suche/Grab übersprungen.

## Nicht im Scope (YAGNI)

- Einzel-Episoden-Overrides (nur Item-Ebene).
- Unterschiedliche Override-Arten (nur „komplett ausnehmen"); Schema lässt Erweiterung zu.
- Notiz-Pflege als vollwertige UI (Feld existiert im Schema, optionale Befüllung).
