# AGENTS.md

Hinweise für AI-Agenten, die in diesem Repo arbeiten.

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
