# ARR Ops 0.1.2

Erstes Verbesserungspaket aus der Analyse vom 20.10.2026.

## Releaseauswahl und Abbruch

- Staffelantworten erlauben nur einen exakten GUID-/Titel-Treffer desselben
  Indexers. Ersatzkandidaten werden ausschließlich aus einer erneuten Suche
  für die konkrete Episode beziehungsweise den konkreten Film gewählt.
- Auch exakte Treffer müssen weiterhin FuN sein und dürfen von ARR weder
  abgelehnt noch für den Download gesperrt sein.
- Analyse-, Such- und Grab-Jobs geben ihr Abbruchsignal an die ARR-Clients
  weiter. Lesende Anfragen und Rate-Limit-Wartezeiten sind abbrechbar.
- Nach Abbruch werden keine weiteren Grab-POSTs gestartet. Ein bereits an ARR
  gesendeter POST darf seine Antwort liefern: Eine angenommene Übergabe wird
  weiterhin mit Download-/Importverfolgung protokolliert. Abbruch kann einen
  bereits gestarteten Download in ARR nicht rückgängig machen.
- Der Parallelpool beendet nach einem Fehler keine neuen Elemente und wartet
  auf laufende Worker. Abgebrochene Jobs erhalten ihren Abschlusszeitpunkt erst,
  wenn die laufenden Schritte beendet sind.

## Scheduler

- Die Pause im Fenster steuert den tatsächlichen Scheduler und wird mit dem
  Tray synchronisiert. Der Zustand bleibt nach einem Neustart erhalten.
- Pause verhindert neue zeitgesteuerte Starts; laufende oder bereits
  eingereihte Jobs werden über ihren eigenen Abbruch im Jobs-Tab beendet.
- Fehler beim Ändern der Pause werden sichtbar angezeigt.
- Ein fehlgeschlagener Zeitplan verhindert keine weiteren Scheduler-Durchläufe.
- Die Tray-Aktion zur Analyse startet die konfigurierten, aktivierten Instanzen.

## Übernommener Arbeitsstand

Diese Version enthält auch die zuvor lokal vorhandenen Verbesserungen an
inkrementeller Analyse, externen IDs, technischen Dateidetails, ARR-Arbeitslisten,
Download-/Importstatus und Performance. Die lokalen Messungen für dieses
Performancepaket stehen in [performance.md](performance.md).

## Prüfung

```powershell
npm run lint
npx vitest run --maxWorkers=4
npx playwright test --workers=2
npm run dist:win
$env:ARR_OPS_ELECTRON_EXE=(Resolve-Path 'release\win-unpacked\ARR Ops.exe').Path
npx playwright test safety-release.spec.ts --workers=1
Remove-Item Env:ARR_OPS_ELECTRON_EXE
```

Der Release-Test startet ausschließlich die neue EXE mit einem isolierten Profil
und einem lokalen synthetischen ARR-Server. Er prüft Releaseauswahl, Abbruch,
IPC, UI und die persistierte Pause nach Neustart. Es werden keine echten
Indexer, Downloadclients oder vorhandenen App-Profile verwendet.

## Weitere Verbesserungspakete

Noch offen sind insbesondere die vollständige Quota-Abdeckung aller Suchpfade,
Kandidaten-Deduplizierung, Automations-Zielpopulation und Search-then-grab,
Phasenfortschritt und Teilergebnisse, weitere gespeicherte Einstellungen,
Electron-Härtung sowie ein kompakterer Kopf für kleine Fenster.
