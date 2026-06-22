# arr-cli — Agenten-CLI für ARR Ops

Headless-CLI, die in derselben Electron-Runtime wie die GUI läuft (nötig für den
Zugriff auf die verschlüsselten API-Keys). Gibt **kompaktes JSON auf stdout** aus;
Logs/Job-Events laufen auf **stderr**.

## Aufruf

- Entwicklung (nach `npm run build`): `npm run cli -- <verb> [optionen]`
  oder `electron out/main/index.cjs --cli <verb> ...`
- Gepackt fuer AI-Agenten: `release\win-unpacked\arr-cli.exe <verb> ...`
- Direkte App-Exe: `release\win-unpacked\ARR Ops.exe --cli <verb> ...`

In Development liest die CLI, wenn vorhanden, `SONARR_URL`/`SONARR_API_KEY` und
`RADARR_URL`/`RADARR_API_KEY` aus `.env` bzw. der Prozess-Umgebung. Diese Werte
uebersteuern nur die CLI-Laufzeit und werden nicht gespeichert. In gepackten Builds
wird `.env` ignoriert; dort nutzt die CLI die in der GUI gespeicherten, per
Electron `safeStorage` verschluesselten Verbindungsdaten.

Wenn die Development-CLI mit einem `NODE_MODULE_VERSION`-Fehler fuer
`better-sqlite3` startet, wurde das native Modul zuletzt fuer System-Node gebaut.
Dann einmal `npx electron-rebuild -f -w better-sqlite3` ausfuehren. Fuer Vitest
stellt `npm rebuild better-sqlite3` das Modul wieder auf System-Node zurueck.

`release\ARR Ops 0.1.0.exe` ist der portable GUI-Wrapper von electron-builder und
nicht fuer stdout-basierte Agenten-CLI-Aufrufe gedacht. `arr-cli.exe` muss im selben
Ordner wie `ARR Ops.exe` liegen; der Wrapper startet die App im CLI-Modus, entfernt
`ELECTRON_RUN_AS_NODE` aus der Kindprozess-Umgebung und reicht stdout/stderr sowie den
Exit-Code unveraendert durch.

**Windows-Konsole:** stdout-Redirect und Pipe-Capture (`> out.json`, `spawn` + stdout-Buffer)
sind zuverlässig — die Bytes sind immer gültiges UTF-8. Interaktive PowerShell-Sessions
brauchen `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` (einmalig im Profil),
sonst erscheinen Umlaute als Mojibake (cp850-Darstellung von UTF-8-Bytes).

## Ausgabeformat

Erfolg: `{"ok":true,"hint":"…","data":…,"page":{…}}` (`page` nur bei Listen)
Fehler: `{"ok":false,"hint":"…","error":{"message":"…","code":"…"}}`
Exit-Code: `0` = ok, `1` = Fehler. `hint` ist immer ein kurzer nächster-Schritt-Tipp.

## Befehle

| Befehl | Zweck |
| --- | --- |
| `library summary` | Gesamtüberblick |
| `library sonarr\|radarr [--limit N] [--offset N] [--non-fun-only] [--full]` | Liste (schlank, paginiert) |
| `item series\|movie <arrId>` | Detail eines Eintrags |
| `quota` | Such-/Grab-Quota |
| `stats` | Verlaufsstatistik |
| `activity [--limit N]` | Letzte Aktivitäten |
| `jobs list \| status <id>` | Jobs |
| `instances list \| test sonarr\|radarr` | Instanzen + Erreichbarkeit |
| `analyze sonarr\|radarr\|all [--ids 1,2] [--sample N]` | Analyse |
| `search sonarr\|radarr --ids 1,2,3` | FuN*-Suche |
| `grab sonarr\|radarr --ids 1,2,3` | Kandidaten grabben |
| `missing radarr --ids 1,2,3 [--grab]` | Klassische Radarr-Missing-Suche; mit `--grab` bester grabbbarer Release |
| `pipeline sonarr\|radarr\|all [--ids 1,2]` | Analyse+Suche+Grab |
| `automation list \| run <goalId>` | Automations-Goals |
| `help` | Befehlsübersicht |

Globale Flags: `--pretty`, `--quiet`, `--full`, `--limit N`, `--offset N`.
Spezialflag: `missing radarr --grab`.

`instances list` liefert pro Eintrag ein `source`-Feld: `env` bedeutet Development-
Override aus `.env`/Umgebung, `gui` bedeutet gespeicherte GUI-Konfiguration.

## Beispiel

```bash
release\win-unpacked\arr-cli.exe library sonarr --non-fun-only --limit 5 > out.json
# {"ok":true,"hint":"… weitere Einträge …","data":[{"arrId":12,"title":"…","status":"searchable","monitored":true,"nonFunFiles":3,"funShare":0.4}],"page":{"total":42,"shown":5,"offset":0}}
```

Klassischer Radarr-Fall fuer fehlende Filme:

```bash
release\win-unpacked\arr-cli.exe missing radarr --ids http://192.168.0.170:7878/movie/14292 --grab --quiet
```

`--ids` akzeptiert Zahlen und Radarr/Sonarr-URLs. Bei `missing radarr` werden IDs
gegen Live-Radarr aufgeloest: interne `movie.id`, `tmdbId` und `titleSlug` werden
verglichen, damit URL-IDs auch dann funktionieren, wenn die lokale Analyse-DB eine
andere `arrId` gespeichert hat.

## Für AI-Agenten

- Ausgabe immer JSON auf stdout; menschliche Logs ausschließlich auf stderr (`--quiet` schaltet sie ab).
- Listen sind absichtlich schlank und paginiert — `--full`/`item` für Details, `--offset`/`--limit` zum Blättern.
- `--ids` für `search`/`grab` aus `library sonarr|radarr` entnehmen.
- `--ids` darf auch URLs enthalten, z. B. `--ids http://host:7878/movie/14292`.
- Aktionen (`analyze`/`search`/`grab`/`pipeline`) sind **synchron**: Sie kehren erst nach Abschluss zurück und liefern Aggregatzahlen (`succeeded`/`failed`/`processed`/`total`) plus `status`.
- `missing radarr --grab` ist nicht FuN-spezifisch: Es fragt Radarr-Releases live ab und grabbed den ersten `approved`/`downloadAllowed` Release.
- Den `hint` jeder Antwort lesen — er nennt den sinnvollen nächsten Schritt.
