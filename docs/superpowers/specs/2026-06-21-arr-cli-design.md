# Design: `arr-cli` — Agenten-CLI für ARR Ops

Datum: 2026-06-21

## Ziel

Eine eigenständige Kommandozeilen-Schnittstelle in einem Unterordner, über die
AI-Agenten (und Menschen) die ARR-Ops-Funktionen headless bedienen können:
Daten abrufen, Analysen/Suchen/Grabs/Pipelines auslösen und Automations-Goals
starten. Die Ausgabe ist bewusst **kompakt** und enthält **kurze Hinweise**, damit
das Context-Fenster eines Agenten nicht unnötig gefüllt wird.

## Nicht-Ziele (YAGNI)

- Kein menschenlesbarer Tabellen-Output (kompaktes JSON genügt für Agenten).
- Kein Daemon / HTTP-Server / interaktiver Modus.
- Keine neue Argument-Parsing-Dependency (Node-eingebautes `util.parseArgs`).
- Keine Verwaltung von Instanzen/Secrets über die CLI (Schreiben von API-Keys
  bleibt der GUI vorbehalten). Die CLI **liest** die von der GUI gespeicherten
  verschlüsselten Keys.

## Architektur

Die CLI läuft über die **Electron-Runtime headless** (kein BrowserWindow). Nur so
ist `safeStorage` verfügbar, mit dem die in `instances.json` mit Windows DPAPI
verschlüsselten API-Keys entschlüsselt werden. Dadurch lassen sich **alle
bestehenden Main-Module wiederverwenden**: `repositories`, `SonarrClient`/
`RadarrClient`, `InstanceStore`, `SecretStore`, `JobRunner`, die Workflow-Helfer
in `ipc.ts` und `createProductionAutomationRunner`. Die GUI muss **nicht** laufen.

### Ablauf pro Aufruf

1. `app.whenReady()` abwarten (nötig für `safeStorage`).
2. `app.setName("arr-ops")` **vor** der Pfadauflösung setzen, damit die CLI
   denselben `userData`-Pfad — und damit dieselbe SQLite-Datei und dieselbe
   `instances.json` — wie die GUI auflöst.
3. DB öffnen (`createAppDatabase(join(app.getPath("userData"), "arr-ops.sqlite"))`),
   anschließend `db.pragma("busy_timeout = 5000")` setzen, damit ein paralleler
   Schreibzugriff durch die laufende GUI nicht sofort mit „database is locked"
   fehlschlägt. `migrateDatabase(db)` wird **nicht** erneut aufgerufen (die GUI ist
   die Migrationsquelle); die CLI erwartet ein bereits migriertes Schema und gibt
   andernfalls einen klaren Fehler mit Hinweis aus.
4. `InstanceStore` + `SecretStore(safeStorage)` + `repositories` + `JobRunner`
   (ohne `onChange`-Anbindung an ein Fenster) aufbauen → `IpcState`.
5. Argumente mit `util.parseArgs` parsen, Befehl dispatchen.
6. Ergebnis als JSON auf **stdout**; Logs und Job-Events auf **stderr**.
7. `app.exit(code)` — `0` = Erfolg, `1` = Fehler.

### Verzeichnis & Build

- Quellcode unter `src/cli/`:
  - `src/cli/index.ts` — Electron-Entry: Bootstrap (Schritte 1–4), Arg-Parsing,
    Dispatch, JSON-Ausgabe, Exit.
  - `src/cli/commands.ts` — Befehls-Implementierungen (nehmen `IpcState` +
    geparste Argumente, liefern ein `CommandResult`).
  - `src/cli/output.ts` — Bau der stabilen JSON-Hülle (Erfolg/Fehler), Pagination,
    Feld-Reduktion, `hint`-Erzeugung.
  - `src/cli/args.ts` — dünner Wrapper um `util.parseArgs` (Verb/Subverb +
    Optionen, `--ids`-Parsing zu `number[]`).
  - `src/cli/README.md` — agenten-orientierte Doku.
- `electron.vite.config.ts`: `main.build.rollupOptions.input` wird von einem
  einzelnen Pfad auf ein Objekt erweitert:
  `{ index: ".../src/main/index.ts", cli: ".../src/cli/index.ts" }`. Ergebnis:
  zusätzlich `out/main/cli.js`.
- `package.json`: Script `"cli": "electron out/main/cli.js"`. Aufruf durch Agenten:
  `npm run cli -- <befehl> [optionen]` oder direkt `electron out/main/cli.js <befehl>`.
  (Setzt einen vorherigen `npm run build` voraus.)

### Wiederverwendung statt Duplizierung

Die Workflow-Logik (Analyse/Suche/Grab/Pipeline) liegt heute als private
`enqueue*`-Helfer in `src/main/ipc.ts`. Minimaler Eingriff: die benötigten Helfer
werden **exportiert** und von der CLI genutzt:

- `enqueueSonarrAnalysis`, `enqueueRadarrAnalysis`
- `enqueueSonarrSearch`, `enqueueRadarrSearch`
- `enqueueSonarrGrab`, `enqueueRadarrGrab`
- `enqueueCombinedJob`
- `createProductionAutomationRunner` (bereits exportiert)

Reads laufen direkt über `repositories` (dieselben Aufrufe wie die IPC-Handler,
z.B. `repositories.mediaItems.summary()`, `.listSonarrRows()`). Es entsteht
**keine** duplizierte Geschäftslogik. Die Datums-Formatierung der Zeilen
(`formatSonarrRowDates`/`formatRadarrRowDates`) wird ebenfalls aus `ipc.ts`
exportiert und wiederverwendet, damit die CLI-Felder zur GUI konsistent sind.

### Synchrones Job-Warten

Die `enqueue*`-Helfer liefern einen Job und laufen über den `JobRunner`. Die CLI
übergibt dem `JobRunner` einen `onChange`-Callback, der Job-Events nach stderr
streamt (außer bei `--quiet`) und ein Promise **resolved**, sobald der Job einen
Endzustand erreicht (`completed`, `failed`, `cancelled`, `blocked_by_budget`).
Danach wird der finale `JobView` (mit `successCount`/`failureCount`) in ein
kompaktes Aktions-Ergebnis übersetzt.

## Befehle

```
# Lesen
arr-cli library summary
arr-cli library sonarr | radarr     [--limit N] [--offset N] [--non-fun-only] [--full]
arr-cli item series|movie <arrId>
arr-cli quota
arr-cli stats
arr-cli activity                    [--limit N]
arr-cli jobs list | status <id>
arr-cli instances list | test sonarr|radarr

# Aktionen (synchron, kompaktes JSON-Ergebnis)
arr-cli analyze sonarr|radarr|all   [--ids 1,2,3] [--sample N]
arr-cli search  sonarr|radarr  --ids 1,2,3
arr-cli grab    sonarr|radarr  --ids 1,2,3
arr-cli pipeline sonarr|radarr|all  [--ids 1,2,3]
arr-cli automation list | run <goalId>

# Hilfe
arr-cli help        (bzw. --help)
```

Globale Flags: `--pretty` (eingerücktes JSON), `--quiet` (keine stderr-Events),
`--full` (alle Felder statt reduziertem Default bei Listen).

## Ausgabeformat (kontextschonend)

Erfolg:

```json
{
  "ok": true,
  "hint": "kurzer, handlungsorientierter Tipp",
  "data": {},
  "page": { "total": 340, "shown": 20, "offset": 0 }
}
```

Fehler:

```json
{
  "ok": false,
  "hint": "wie der Fehler behoben wird",
  "error": { "message": "…", "code": "…" }
}
```

Regeln:

- **Kompaktes JSON ist Default** (kein Whitespace, einzeilig). `--pretty` rückt ein.
- `page` nur bei Listenbefehlen.
- **`hint`** ist immer ein einzelner kurzer Satz mit dem sinnvollen nächsten Schritt.
  Beispiele:
  - Liste gekürzt: `"320 weitere Einträge — nächste Seite mit --offset 20"`
  - Suche fertig: `"12 FuN*-Kandidaten gefunden. Herunterladen mit: grab sonarr --ids 5,8,12"`
  - Leer: `"Keine non-FuN-Dateien gefunden. Ggf. zuerst 'analyze sonarr' ausführen."`
  - Fehler: `"API-Key fehlt — in der GUI unter Einstellungen hinterlegen."`
- **Listen sind schlank & paginiert**: Default-Limit 20 (via `--limit`/`--offset`).
  Reduzierte Felder per Default (Sonarr: `arrId, title, status, nonFunFiles,
  funShare, monitored`; Radarr analog mit `year`). `--full` liefert alle Felder;
  `item …` liefert die vollständigen Details eines Eintrags.
- **Aktions-Ergebnisse minimal**: nur Aggregatzahlen (`searched`,
  `candidatesFound`, `grabbed`, `failed`, plus `jobId`, `status`), **keine** Event-
  Logs auf stdout. Details laufen nach stderr.

## Fehlerbehandlung

- Fehlender/ungültiger Befehl → `ok:false`, `code:"unknown_command"`, `hint` verweist auf `help`.
- Fehlende Pflicht-Option (z.B. `--ids` bei `search`) → `code:"missing_argument"`.
- Fehlender API-Key / nicht erreichbare Instanz → `code:"instance_error"`, Hinweis auf GUI-Einstellungen.
- DB nicht gefunden / nicht migriert → `code:"db_unavailable"`, Hinweis, die GUI mindestens einmal zu starten.
- Job endet mit `failed`/`blocked_by_budget` → `ok:true` mit aussagekräftigem `hint`
  (die Aktion lief, aber das Quota/ein Fehler hat sie begrenzt) und den Aggregatzahlen.
- Unerwartete Exceptions → `code:"internal_error"`, Message gekürzt; voller Stack nach stderr.

## Tests

Vitest-Unit-Tests, an bestehenden Tests orientiert:

- `output.ts`: korrekte Hüllen für Erfolg/Fehler, Pagination-Berechnung,
  Feld-Reduktion, `hint`-Inhalte bei leeren/gekürzten Ergebnissen.
- `args.ts`: Parsing von Verb/Subverb, `--ids` → `number[]`, Flags, Fehlerfälle.
- `commands.ts`: Routing und Read-Befehle gegen einen gemockten `IpcState`
  (in-memory `repositories` via `createInMemoryDatabase` + `migrateDatabase`),
  inklusive Verifikation, dass Aktions-Befehle die richtigen `enqueue*`-Helfer
  aufrufen (gemockt) und das kompakte Ergebnis erzeugen.

Kein End-to-End-Test gegen echte Sonarr/Radarr-Instanzen (außerhalb des Scopes;
dafür existiert der separate Live-Test-Pfad).

## Doku (`src/cli/README.md`)

Kurz und agenten-orientiert:

- Aufrufschema (`npm run cli -- …` / `electron out/main/cli.js …`).
- Vollständige Befehlstabelle mit je einem Beispiel-Aufruf und gekürzter
  Beispiel-Ausgabe.
- Erläuterung der JSON-Hülle, des `hint`-Feldes, der Pagination und der Exit-Codes.
- Abschnitt „Für AI-Agenten": Ausgabe ist immer JSON auf stdout (Logs auf stderr),
  Listen sind paginiert/schlank, `--ids` werden über `library …` ermittelt,
  Aktionen sind synchron.
```
