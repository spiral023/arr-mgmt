# Performance in ARR Ops 0.1.1

Lokale Messung vom 20.10.2026 mit einer unveränderten Ausgangskopie der App-Datenbank:
7.784 Titel (2.573 Serien und 5.211 Filme), 75.519 Dateieinträge. Keine echten
Indexer-Suchen, Grabs oder Downloads wurden für die Messung ausgelöst.

| Arbeitsschritt | Vorher | Nachher |
| --- | ---: | ---: |
| Analyse einer vorhandenen Serie mit 801 Dateien speichern | 36.141 ms | 16–20 ms |
| Datumswerte der gesamten Bibliothek formatieren | 705 ms | 9–11 ms |
| Lokaler Schreibpfad für alle 2.573 Serien, einschließlich Aktivitätslog und Jobfortschritt | nicht vollständig wiederholt | 7,7 s |

Beim letzten Test blieb die maximale Timer-Verzögerung bei 29 ms, der längste
einzelne Speicherschritt bei 19 ms. Das ist ein lokaler Replay, keine Vorhersage
der Gesamtlaufzeit mit Sonarr oder Indexern. Netzwerkwartezeit und die bisherigen
Such-/Grab-Limits gelten weiterhin.

Zusätzlich wurde die tatsächlich gepackte Desktop-App 0.1.1 bei 1.440 × 1.000
Pixeln mit einer isolierten Kopie dieses Profils geprüft: 100 große Serien mit
22.576 Dateien wurden über einen lokalen Sonarr-Testserver neu analysiert.
201 Metadatenanfragen benötigten mit dem unveränderten Limiter 25,4 Sekunden.
Die längste gemessene IPC-/Bedienantwort währenddessen war 133 ms; keine
Rendererfehler, keine fehlgeschlagenen Serien und keine Such-/Grab-Anfragen.

## Änderungen

- Index für Dateien pro Titel/Kind sowie Indizes für Cooldowns, Ereignisse und
  Fremdschlüssel. Die idempotente Migration ergänzt sie auch in bestehenden DBs.
- Dateiinformationen und externe IDs werden direkt beim Einfügen gespeichert.
  Die bisherigen nachträglichen Updates pro Datei entfallen. Ein Titel wird
  weiterhin atomar ersetzt; Fehler rollen die gesamte Änderung zurück.
- Begrenzter Cache für vorbereitete SQL-Anweisungen; gezielte, indizierte
  Zeitstempel- und Kandidatenabfragen statt vollständiger Historienaggregation.
- WAL für parallele GUI-/CLI-Lesezugriffe, explizites `synchronous=FULL` und
  fünf Sekunden Busy-Timeout. Keine verringerte Schreibsicherheit.
- Jobfortschritt wird höchstens alle 250 ms gespeichert/gesendet. Endzustände,
  Abbruch und Budgetblockierung werden sofort gespeichert. Aktivitäts- und
  Quota-Einträge bleiben vollständig; Fortschritt im Speicher ist jederzeit exakt.
- Lange Schleifen geben den Ereignisloop regelmäßig frei.
- Wiederverwendete Datumsformatierer mit begrenztem Timestamp-Cache,
  zusammengefasste gleichzeitige IPC-Leseanfragen und stabile unveränderte
  Tabellenzeilen. Filtereingaben und Tabellenupdates können getrennt rendern.
- Joblogs rendern nur den sichtbaren Bereich, bleiben scrollbar und vollständig
  kopierbar. Ältere Logs werden vollständig aus der DB gelesen, auch nach Neustart.

## Prüfung wiederholen

```powershell
npx vitest run
npx playwright test
node scripts/benchmark-performance.mjs --database <DB-Kopie.sqlite> --replay
```

Der Benchmark erstellt eigene Kopien unter dem temporären Benutzerverzeichnis
und gibt dort `results.json` aus. Er verändert die angegebene Ausgangsdatei nicht.
Optional vergleicht `--baseline <before.cjs>` einen zuvor mit esbuild erzeugten
Bundle-Export von `createRepositories` und `migrateDatabase` mit dem aktuellen Stand.
Der Browser-Stresstest prüft 8.000 Serien, 10.000 unterschiedlich hohe Logeinträge,
Filter, Scrollen bis zum letzten Eintrag und vollständigen Logexport bei 1.366 und
414 Pixeln Breite mit Reduced Motion.

Die neue EXE erst nach Beenden der bisherigen App einschließlich Tray verwenden.
