# arr-cli — Agenten-CLI für ARR Ops

Headless-CLI, die in derselben Electron-Runtime wie die GUI läuft (nötig für den
Zugriff auf die verschlüsselten API-Keys). Gibt **kompaktes JSON auf stdout** aus;
Logs/Job-Events laufen auf **stderr**.

## Aufruf

- Entwicklung (nach `npm run build`): `npm run cli -- <verb> [optionen]`
  oder `electron out/main/index.js --cli <verb> ...`
- Gepackt: `"ARR Ops.exe" --cli <verb> ...`

**Windows-Konsole:** Die .exe ist ein GUI-Programm. Für zuverlässige Ausgabe per
`spawn`/`exec` mit Pipe-Capture lesen oder in eine Datei umleiten (`> out.json`);
auf interaktive Live-Ausgabe im Terminal nicht verlassen.

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
| `pipeline sonarr\|radarr\|all [--ids 1,2]` | Analyse+Suche+Grab |
| `automation list \| run <goalId>` | Automations-Goals |

Globale Flags: `--pretty`, `--quiet`, `--full`, `--limit N`, `--offset N`.

## Beispiel

```bash
electron out/main/index.js --cli library sonarr --non-fun-only --limit 5 > out.json
# {"ok":true,"hint":"… weitere Einträge …","data":[{"arrId":12,"title":"…","status":"searchable","monitored":true,"nonFunFiles":3,"funShare":0.4}],"page":{"total":42,"shown":5,"offset":0}}
```

## Für AI-Agenten

- Ausgabe immer JSON auf stdout; menschliche Logs ausschließlich auf stderr (`--quiet` schaltet sie ab).
- Listen sind absichtlich schlank und paginiert — `--full`/`item` für Details, `--offset`/`--limit` zum Blättern.
- `--ids` für `search`/`grab` aus `library sonarr|radarr` entnehmen.
- Aktionen (`analyze`/`search`/`grab`/`pipeline`) sind **synchron**: Sie kehren erst nach Abschluss zurück und liefern Aggregatzahlen (`succeeded`/`failed`/`processed`/`total`) plus `status`.
- Den `hint` jeder Antwort lesen — er nennt den sinnvollen nächsten Schritt.
