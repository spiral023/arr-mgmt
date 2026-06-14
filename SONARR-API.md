# Sonarr API Notizen

Stand: 2026-06-13

Quellen:

- Offizielle API-Dokumentation: https://sonarr.tv/docs/api/#v3
- OpenAPI-Spezifikation: https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json

## Erreichbarkeit

Lokale Instanz:

- Base URL: `http://192.168.0.170:8989`
- API Base: `http://192.168.0.170:8989/api/v3`
- Getesteter Endpoint: `GET /api/v3/system/status`
- Ergebnis: HTTP `200`
- Gemeldete Version: Sonarr `4.0.17.2952`
- `urlBase`: leer

## Authentifizierung

Sonarr v3/v4 akzeptiert den API-Key laut OpenAPI auf zwei Arten:

- Header: `X-Api-Key: <SONARR_API_KEY>`
- Query-Parameter: `?apikey=<SONARR_API_KEY>`

Fuer Skripte ist der Header vorzuziehen, damit der Key nicht in URLs, Browser-History oder Proxy-Logs landet.

PowerShell-Beispiel:

```powershell
$base = "http://192.168.0.170:8989/api/v3"
$headers = @{ "X-Api-Key" = $env:SONARR_API_KEY }
Invoke-RestMethod -Uri "$base/system/status" -Headers $headers
```

## Wichtige Ressourcen

### Serien

`GET /api/v3/series`

Liefert alle Serien. Wichtige Felder:

- `id`
- `title`
- `path`
- `monitored`
- `seasons`
- `qualityProfileId`
- `seriesType`
- `statistics`

`GET /api/v3/series/{id}`

Liefert eine einzelne Serie.

### Episoden

`GET /api/v3/episode?seriesId=<id>&includeEpisodeFile=true`

Liefert Episoden einer Serie. Relevante Query-Parameter:

- `seriesId`
- `seasonNumber`
- `episodeIds`
- `episodeFileId`
- `includeSeries`
- `includeEpisodeFile`
- `includeImages`

Wichtige Felder:

- `id`
- `seriesId`
- `seasonNumber`
- `episodeNumber`
- `title`
- `airDateUtc`
- `hasFile`
- `monitored`
- `episodeFileId`
- `episodeFile`

Wenn `includeEpisodeFile=true` gesetzt ist, kann `episodeFile.releaseGroup` direkt in der Episode enthalten sein.

### Episode-Dateien

`GET /api/v3/episodefile?seriesId=<id>`

Liefert die vorhandenen Dateien einer Serie. Relevante Query-Parameter:

- `seriesId`
- `episodeFileIds`

Wichtige Felder:

- `id`
- `seriesId`
- `seasonNumber`
- `relativePath`
- `path`
- `sceneName`
- `releaseGroup`
- `quality`
- `languages`
- `customFormats`
- `customFormatScore`
- `qualityCutoffNotMet`

Das Feld `releaseGroup` ist die zentrale Basis fuer die FuN*-Auswertung vorhandener Dateien.

### Releasesuche

`GET /api/v3/release?episodeId=<episodeId>`

Startet bzw. liefert die manuelle Suche fuer eine Episode. Relevante Query-Parameter:

- `seriesId`
- `episodeId`
- `seasonNumber`

Wichtige Felder in Suchergebnissen:

- `title`
- `releaseGroup`
- `episodeId`
- `episodeIds`
- `seriesId`
- `seasonNumber`
- `quality`
- `languages`
- `indexer`
- `approved`
- `downloadAllowed`
- `rejected`
- `rejections`
- `size`
- `guid`

`POST /api/v3/release`

Grabt ein konkretes Release. Praktisch wird dafuer das ausgewaehlte `ReleaseResource` aus `GET /api/v3/release` zurueckgesendet.

### Automatische Suche per Command

`POST /api/v3/command`

Allgemeines Command-Format:

```json
{
  "name": "EpisodeSearch",
  "episodeIds": [12345]
}
```

Bekannte Such-Commands:

- `EpisodeSearch` mit `episodeIds`
- `SeasonSearch` mit `seriesId` und `seasonNumber`
- `SeriesSearch` mit `seriesId`

Antwort ist ein `CommandResource` mit Feldern wie:

- `id`
- `name`
- `commandName`
- `status`
- `queued`
- `started`
- `ended`
- `message`

Den Status kann man mit `GET /api/v3/command/{id}` abfragen.

Wichtig: `EpisodeSearch` allein erzwingt keine Releasegruppe. Damit Sonarr automatisch FuN bevorzugt, muss die Releasegruppe ueber Custom Formats, Release Profiles oder die vorhandenen Qualitaetsregeln entsprechend bewertet werden. Wenn wirklich nur FuN-Releases geholt werden sollen, ist `GET /api/v3/release?episodeId=...` plus clientseitiges Filtern auf `releaseGroup` und anschliessendes `POST /api/v3/release` kontrollierter.

### Wanted

`GET /api/v3/wanted/missing`

Liefert fehlende Episoden. Relevante Query-Parameter:

- `page`
- `pageSize`
- `sortKey`
- `sortDirection`
- `includeSeries`
- `includeImages`
- `monitored`

`GET /api/v3/wanted/cutoff`

Liefert Episoden, die den Cutoff noch nicht erreicht haben. Relevante Query-Parameter:

- `page`
- `pageSize`
- `sortKey`
- `sortDirection`
- `includeSeries`
- `includeEpisodeFile`
- `includeImages`
- `monitored`

## FuN*-Normalisierung

Ziel: Releasegruppe `FuN` und Varianten als eine Gruppe `FuN*` zaehlen.

Empfohlene Normalisierung:

```text
trim(releaseGroup).toLowerCase().startsWith("fun") => "FuN*"
sonst: releaseGroup oder "(unknown)"
```

Das fasst zum Beispiel diese Varianten zusammen:

- `FuN`
- `FUN`
- `FuNHD`
- `FuN-Group`
- `FuN_Whatever`

Wenn False Positives wie `FunnyGroup` ausgeschlossen werden sollen, strenger pruefen:

```regex
^fun($|[^a-z0-9])
```

Fuer dein Ziel klingt die Prefix-Regel `^fun` passender, weil du explizit `FuN*` willst.

## Auswertung pro Serie

Minimaler Ablauf:

1. Serie bestimmen:
   - `GET /api/v3/series`
   - passende `series.id` auswaehlen.
2. Episoden mit Dateiinfos laden:
   - `GET /api/v3/episode?seriesId=<id>&includeEpisodeFile=true`
3. Relevante Episoden filtern:
   - `monitored == true`
   - bereits ausgestrahlt, falls `airDateUtc` gesetzt ist
   - Specials je nach Wunsch einschliessen oder ausschliessen
4. Pro Episode die Releasegruppe bestimmen:
   - bevorzugt `episode.episodeFile.releaseGroup`
   - alternativ ueber `GET /api/v3/episodefile?seriesId=<id>` und `episodeFileId`
5. FuN*-Quote berechnen:
   - `funEpisodes = Episoden mit releaseGroup startsWith "fun"`
   - `availableEpisodes = relevante Episoden mit Datei`
   - `funShare = funEpisodes / availableEpisodes`
6. Serie als FuN-Kandidat markieren, wenn:
   - `funEpisodes > 0`
   - `funEpisodes < availableEpisodes`

Damit wird nur bei Serien angesetzt, in denen FuN bereits vorkommt, aber noch nicht vollstaendig ist.

## Such-Trigger fuer nicht vollstaendige FuN*-Serien

Es gibt zwei sinnvolle Modi.

### Modus A: Automatische EpisodeSearch

Geeignet, wenn Sonarr bereits so konfiguriert ist, dass FuN bevorzugt wird.

Kandidaten:

- relevante Episoden der Serie
- `hasFile == false`, oder
- Datei vorhanden, aber `releaseGroup` ist nicht `FuN*`

Request:

```http
POST /api/v3/command
Content-Type: application/json
X-Api-Key: <SONARR_API_KEY>

{
  "name": "EpisodeSearch",
  "episodeIds": [12345, 12346]
}
```

Vorteil: einfach und Sonarr entscheidet selbst.

Nachteil: Ohne passende Custom Formats oder Release Profiles kann Sonarr wieder Nicht-FuN-Releases greifen.

### Modus B: Manuelle Release-Pruefung und gezielter Grab

Geeignet, wenn wirklich FuN bevorzugt oder erzwungen werden soll.

Pro Kandidaten-Episode:

1. `GET /api/v3/release?episodeId=<episodeId>`
2. Releases filtern:
   - `releaseGroup` normalisiert zu `FuN*`
   - `downloadAllowed == true`
   - `approved == true`, falls gesetzt
   - `rejected == false`, falls gesetzt
3. Bestes Release nach Qualitaet, Custom-Format-Score, Seedern/Groesse auswaehlen.
4. Ausgewaehltes Release per `POST /api/v3/release` grabben.

Vorteil: kontrolliert wirklich die Releasegruppe.

Nachteil: mehr API-Calls und man muss Ranking/Fehlerfaelle selbst behandeln.

## Empfohlene Strategie

Fuer dein Ziel ist diese Logik am saubersten:

1. Pro Serie FuN*-Quote berechnen.
2. Nur Serien mit `0 < FuN*-Dateien < vorhandene Dateien` weiter behandeln.
3. Fuer jede nicht-FuN*-Episode erst `GET /release?episodeId=...` ausfuehren.
4. Wenn ein passendes FuN*-Release verfuegbar und downloadbar ist, gezielt `POST /release`.
5. Wenn kein FuN*-Release verfuegbar ist, optional nichts tun oder eine normale `EpisodeSearch` nur dann ausloesen, wenn Nicht-FuN-Upgrades weiterhin akzeptiert sind.

So vermeidest du, dass eine Suche massenhaft normale Releases nachzieht, obwohl das eigentliche Ziel FuN-Vervollstaendigung ist.

## Fehler- und Statusbehandlung

Typische Checks:

- HTTP `401`/`403`: API-Key falsch oder keine Berechtigung.
- HTTP `404`: falscher Endpoint oder `urlBase` nicht beruecksichtigt.
- `release.rejected == true`: Sonarr lehnt das Release ab; `rejections` erklaert den Grund.
- `downloadAllowed == false`: Release nicht direkt greifbar.
- Command-Status nach `POST /command` per `GET /command/{id}` pollen.

Bei Massensuchen sollten Requests gedrosselt werden, damit Indexer und Download-Clients nicht unnoetig belastet werden.
