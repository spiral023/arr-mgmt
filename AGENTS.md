# AGENTS.md

Hinweise für AI-Agenten, die in diesem Repo arbeiten.

## CLI nutzen (bevorzugter Weg)

Die App stellt eine Headless-CLI bereit, die **immer dann genutzt werden soll, wenn
eine Lese- oder Aktions-Operation abgebildet werden kann** — also bei fast allen
Diagnose-, Analyse- und Steuerungsaufgaben. Die CLI läuft in derselben Electron-Runtime
wie die GUI und hat daher Zugriff auf verschlüsselte API-Keys.

### Wann CLI, wann direkter DB-Zugriff?

| Situation | Methode |
| --- | --- |
| Library-Überblick, Item-Details, Jobs, Quota, Stats | **CLI** |
| Aktionen auslösen (analyze / search / grab / pipeline) | **CLI** |
| Komplexe SQL-Joins, die kein CLI-Befehl abdeckt | **DB direkt** (siehe unten) |
| Filterlogik debuggen (Pass/Fail-Counts) | **DB direkt** |

### Aufruf (Development)

```powershell
# Erst bauen falls nötig:
npm run build

# CLI aufrufen — stdout ist immer gültiges UTF-8-JSON:
$result = electron out/main/index.cjs --cli library summary | ConvertFrom-Json
# oder kompakt (kein pretty-print):
electron out/main/index.cjs --cli quota --quiet
```

Im Development liest die CLI optional `SONARR_URL`/`SONARR_API_KEY` und
`RADARR_URL`/`RADARR_API_KEY` aus `.env` bzw. der Prozess-Umgebung. Diese Werte
übersteuern nur die CLI-Laufzeit und werden nicht gespeichert. In gepackten Builds
wird `.env` ignoriert; dort nutzt die CLI die in der GUI gespeicherten,
verschlüsselten Verbindungsdaten. `instances list` zeigt pro Instanz `source: "env"`
oder `source: "gui"`.

Wenn die Development-CLI mit einem `NODE_MODULE_VERSION`-Fehler für `better-sqlite3`
startet, wurde das native Modul zuletzt für System-Node gebaut. Dann einmal
`npx electron-rebuild -f -w better-sqlite3` ausführen. Für Vitest stellt
`npm rebuild better-sqlite3` das Modul wieder auf System-Node zurück.

### Aufruf (gepackte App / Agenten)

Für gebaute Windows-Artefakte bevorzugt die Companion-CLI verwenden:

```powershell
release\win-unpacked\arr-cli.exe library summary --quiet
release\win-unpacked\arr-cli.exe library radarr --limit 20 --quiet
```

`arr-cli.exe` liegt neben `release\win-unpacked\ARR Ops.exe`, startet die App im
CLI-Modus, entfernt `ELECTRON_RUN_AS_NODE` für den Kindprozess und reicht
stdout/stderr/Exit-Code unverändert durch. Die portable Einzeldatei
`release\ARR Ops 0.1.0.exe` ist der GUI-Wrapper und nicht für stdout-basierte
Agenten-CLI-Aufrufe gedacht.

**Build-Voraussetzung:** `npm run dist:win` baut über `npm run build:cli-wrapper`
auch die Companion-CLI und benötigt dafür das **.NET 8 SDK** (`dotnet` im PATH,
siehe https://dotnet.microsoft.com/download). Fehlt es, bricht der Schritt mit
einer entsprechenden Fehlermeldung ab.

**Wichtig (Windows):** Für Pipe-/Redirect-Capture (`> out.json`, `ConvertFrom-Json`)
braucht es kein spezielles Encoding — die Bytes sind immer UTF-8. Interaktive
PowerShell-Sessions ggf. einmalig mit
`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` reparieren.

### Ausgabeformat

```
Erfolg: {"ok":true,"hint":"…","data":…,"page":{…}}
Fehler:  {"ok":false,"hint":"…","error":{"message":"…","code":"…"}}
```

`hint` enthält immer den empfohlenen nächsten Schritt — unbedingt lesen.
Exit-Code `0` = ok, `1` = Fehler.

### Verfügbare Befehle

| Befehl | Wann nutzen |
| --- | --- |
| `library summary` | Ersten Überblick verschaffen |
| `library sonarr\|radarr [--limit N] [--offset N] [--non-fun-only] [--full]` | Item-Liste (paginiert) |
| `item series\|movie <arrId>` | Einzelnes Item im Detail |
| `quota` | Such-/Grab-Kontingent prüfen |
| `stats` | Verlaufsstatistik |
| `activity [--limit N]` | Letzte Aktivitäten |
| `jobs list \| status <id>` | Laufende/abgeschlossene Jobs |
| `instances list \| test sonarr\|radarr` | Instanzen und Erreichbarkeit |
| `analyze sonarr\|radarr\|all [--ids 1,2] [--sample N]` | Analyse anstoßen |
| `search sonarr\|radarr --ids 1,2,3` | FuN-Suche für Items |
| `grab sonarr\|radarr --ids 1,2,3` | Kandidaten grabben |
| `missing radarr --ids 1,2,3 [--grab]` | Klassische Radarr-Missing-Suche; mit `--grab` bester grabbbarer Release |
| `pipeline sonarr\|radarr\|all [--ids 1,2]` | Analyse + Suche + Grab am Stück |
| `automation list \| run <goalId>` | Automations-Goals |

Globale Flags: `--pretty` (lesbares JSON), `--quiet` (kein stderr-Log),
`--full` (vollständige Felder), `--limit N`, `--offset N`.
Spezialflag: `missing radarr --grab`.

### Typische Agenten-Workflows

```powershell
# 1. Überblick holen
electron out/main/index.cjs --cli library summary --quiet

# 2. Nicht-Fun-Items einer Instanz auflisten (IDs für folgende Aktionen)
electron out/main/index.cjs --cli library sonarr --non-fun-only --limit 20 --quiet

# 3. Analyse für bestimmte Items anstoßen
electron out/main/index.cjs --cli analyze sonarr --ids 12,34,56 --quiet

# 4. Kompletten Pipeline-Durchlauf
electron out/main/index.cjs --cli pipeline all --quiet

# 5. Klassischer Radarr-Missing-Grab; IDs dürfen auch Radarr-URLs sein
release\win-unpacked\arr-cli.exe missing radarr --ids http://192.168.0.170:7878/movie/14292 --grab --quiet
```

Aktionen (`analyze`/`search`/`grab`/`pipeline`) laufen **synchron** und liefern
Aggregatzahlen (`succeeded`/`failed`/`processed`/`total`) plus `status` zurück.

---

## Datenbank zur Analyse abfragen (read-only)

Für Diagnosen ("warum hat der Job X getan?", Filter-/Daten-Plausibilität) ist es am
schnellsten, die echte SQLite-DB der App direkt abzufragen, statt nur Code zu lesen.

- **DB-Pfad:** `app.getPath("userData")/arr-ops.sqlite`, auf Windows also
  `%APPDATA%/arr-ops/arr-ops.sqlite` (Dev-Build; Name aus `package.json` → `arr-ops`).
- **Immer auf einer Kopie arbeiten.** Erst in den Scratchpad kopieren, dann lesen — die
  laufende App hält die DB ggf. geöffnet (Lock).
- **`better-sqlite3` aus `node_modules` NICHT mit System-Node verwenden.** Es ist gegen
  Electrons Node-ABI kompiliert (`NODE_MODULE_VERSION`-Mismatch). Stattdessen das in
  Node ≥ 22 eingebaute `node:sqlite` nutzen:

  ```js
  // diag.mjs  →  node --experimental-sqlite diag.mjs
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync(String.raw`<scratchpad>\arr.sqlite`, { readOnly: true });
  const all = (s, ...p) => db.prepare(s).all(...p);
  console.log(all(`select kind, count(*) c from media_items group by kind`));
  ```

- **Queries in eine `.mjs`-Datei schreiben**, nicht inline via `node -e` — sonst zerschießt
  das Shell-Quoting die SQL-String-Literale.
- **Filterlogik gegen echte Daten simulieren:** Die Automation-Filter liegen in
  [filtering.ts](src/main/automation/filtering.ts); bei Bedarf 1:1 in JS nachbauen und
  pro Filter die Pass-/Fail-Counts ausgeben, um den Engpass zu finden.

Relevante Tabellen: `media_items` (Item-Ebene: `has_file`, `fun_share`, `monitored`,
`last_analyzed_at`), `media_files` (Datei-Ebene: `is_fun`), `activity_log`
(`action`/`status` für search/grab → `lastSearchedAt`/`lastGrabbedAt`),
`release_candidates`, `automation_goals` (`filters_json`).
