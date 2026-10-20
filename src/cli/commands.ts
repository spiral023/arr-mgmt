import {
  formatActivityRow,
  formatRadarrRowDates,
  formatSonarrRowDates,
  getQuotaSummary,
  type IpcState,
} from "../main/ipc";
import { SonarrClient } from "../main/arr/sonarr-client";
import { RadarrClient } from "../main/arr/radarr-client";
import { isGrabbableRelease } from "../main/arr/sonarr-operations";
import type { RadarrMovie, SonarrEpisode } from "../main/arr/arr-types";
import type { InstanceKind } from "../shared/ipc-contracts";
import type { ParsedArgs } from "./args";
import { fail, ok, paginate, pickFields, type CommandResult } from "./output";
import { resolveMovieIdentity } from "./movie-ids";
import { refreshTransfers, getWanted } from "../main/arr/library-service";
import { analyzeRadarrMovies } from "../main/arr/analysis-service";
import { extractDownloadId } from "../main/arr/download-id";
import { mapConcurrent } from "../main/async/map-concurrent";

export const DEFAULT_LIMIT = 20;

export const SONARR_LIST_FIELDS = ["arrId", "title", "status", "monitored", "nonFunFiles", "funShare"] as const;
export const RADARR_LIST_FIELDS = ["arrId", "title", "year", "status", "monitored", "nonFunFiles", "funShare"] as const;

export async function runCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  if (args.sub === "all" && args.ids.length) {
    return fail("invalid_scope", "--ids erfordert sonarr oder radarr als Ziel", "IDs gehören zu genau einer Instanz; beide Instanzen getrennt aufrufen.");
  }
  if (args.sub === "sonarr" && args.ids.length && ["analyze", "search", "grab", "pipeline"].includes(args.verb) &&
    args.idType !== "auto" && args.idType !== "arr") {
    const client = new SonarrClient(state.instanceStore.getWithApiKey("sonarr"));
    const series = await client.getSeries();
    const ids = args.ids.map((id) => {
      const matches = series.filter((item) => (args.idType === "tvdb" ? item.tvdbId : item.tmdbId) === id);
      if (matches.length !== 1) throw new Error(`Sonarr ${args.idType}-ID ${id} ist unbekannt oder mehrdeutig`);
      return matches[0].id;
    });
    args = { ...args, ids: [...new Set(ids)], idType: "arr" };
  }
  switch (args.verb) {
    case "library":
      return libraryCommand(state, args);
    case "item":
      return itemCommand(state, args);
    case "quota":
      return ok(getQuotaSummary(state), "Quota-Fenster pro Window-Stunden. 'stats' zeigt historische Aktivität.");
    case "stats":
      return ok(state.repositories.stats.summary(), "Aggregierte Verlaufsdaten. Aktuelle Bibliothek via 'library summary'.");
    case "activity":
      return activityCommand(state, args);
    case "jobs":
      return jobsCommand(state, args);
    case "instances":
      return instancesCommand(state, args);
    case "analyze":
      return analyzeCommand(state, args);
    case "search":
      return searchCommand(state, args);
    case "grab":
      return grabCommand(state, args);
    case "pipeline":
      return pipelineCommand(state, args);
    case "missing":
      return missingCommand(state, args);
    case "automation":
      return automationCommand(state, args);
    case "wanted":
    case "transfers":
    case "parse":
      return readArrCommand(state, args);
    case "help":
      return helpCommand();
    default:
      return fail("unknown_command", `Unbekannter Befehl: ${args.verb}`, "Verfügbare Befehle mit 'help' anzeigen.");
  }
}

async function readArrCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  const kind = args.sub;
  if (kind !== "sonarr" && kind !== "radarr") return fail("missing_argument", `${args.verb} erwartet sonarr|radarr`, "Beispiele siehe help.");
  if (args.verb === "transfers") {
    const rows = args.refresh ? await refreshTransfers(state, kind) : state.repositories.transfers.list()
      .filter((item) => item.instanceId === state.repositories.instances.findIdByKind(kind));
    const { slice, page } = paginate(rows, args.offset ?? 0, args.limit ?? DEFAULT_LIMIT);
    return ok(slice, "Grab bestätigt nur die Übergabe. --refresh prüft Queue und Import-Historie, ohne Downloads auszulösen.", page);
  }
  if (args.verb === "parse") {
    if (!args.rest[0]) return fail("missing_argument", "Releasename fehlt", 'parse sonarr "Serie.S01E01.German.1080p-FuN"');
    const config = state.instanceStore.getWithApiKey(kind);
    const client = kind === "sonarr" ? new SonarrClient(config) : new RadarrClient(config);
    return ok(await client.parseReleaseName(args.rest.join(" ")), "Nur Namensanalyse; kein Import oder Download ausgelöst.");
  }
  const mode = args.rest[0];
  if (mode !== "missing" && mode !== "cutoff") return fail("missing_argument", "wanted erwartet missing|cutoff", "wanted radarr missing --limit 20");
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, 100);
  const offset = args.offset ?? 0;
  const pageNumber = Math.floor(offset / limit) + 1;
  const result = await getWanted(state, kind, mode, pageNumber, limit);
  const rows: Array<RadarrMovie | SonarrEpisode> = result.records.slice(offset % limit);
  if (rows.length < limit && pageNumber * limit < result.totalRecords) {
    const next = await getWanted(state, kind, mode, pageNumber + 1, limit);
    rows.push(...next.records.slice(0, limit - rows.length));
  }
  return ok(rows, mode === "missing" ? "ARR berücksichtigt Veröffentlichungsdaten; ohne Datei bedeutet nicht automatisch bereits verfügbar." :
    "Unter dem Qualitätsziel des ARR-Profils; unabhängig von FuN-Coverage.",
    { total: result.totalRecords, offset, shown: rows.length });
}

function libraryCommand(state: IpcState, args: ParsedArgs): CommandResult {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const offset = args.offset ?? 0;

  if (args.sub === "summary") {
    return ok(state.repositories.mediaItems.summary(), "Gesamtüberblick. Einzellisten via 'library sonarr|radarr'.");
  }
  if (args.sub === "sonarr") {
    let rows = state.repositories.mediaItems.listSonarrRows().map(formatSonarrRowDates);
    if (args.nonFunOnly) rows = rows.filter((row) => row.nonFunFiles > 0);
    const { slice, page } = paginate(rows, offset, limit);
    const data = args.full ? slice : slice.map((row) => pickFields(row, SONARR_LIST_FIELDS));
    return ok(data, listHint(page, "library sonarr"), page);
  }
  if (args.sub === "radarr") {
    let rows = state.repositories.mediaItems.listRadarrRows().map(formatRadarrRowDates);
    if (args.nonFunOnly) rows = rows.filter((row) => row.nonFunFiles > 0);
    const { slice, page } = paginate(rows, offset, limit);
    const data = args.full ? slice : slice.map((row) => pickFields(row, RADARR_LIST_FIELDS));
    return ok(data, listHint(page, "library radarr"), page);
  }
  return fail("missing_argument", "library erwartet: summary | sonarr | radarr", "Beispiel: library sonarr --limit 20");
}

function itemCommand(state: IpcState, args: ParsedArgs): CommandResult {
  const kind = args.sub;
  const arrId = Number(args.rest[0]);
  if ((kind !== "series" && kind !== "movie") || !Number.isInteger(arrId) || arrId <= 0) {
    return fail("missing_argument", "item erwartet: series|movie <arrId>", "Beispiel: item series 123 (arrId aus 'library' entnehmen).");
  }
  const details = state.repositories.mediaItems.itemDetails(kind, arrId);
  return ok(details, `Details zu ${kind} ${arrId}: non-FuN-Dateien und gespeicherte Kandidaten.`);
}

function activityCommand(state: IpcState, args: ParsedArgs): CommandResult {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const rows = state.repositories.activityLog.listRecent(limit).map(formatActivityRow);
  return ok(rows, `Letzte ${rows.length} Aktivitäten. Mehr via --limit N.`);
}

function jobsCommand(state: IpcState, args: ParsedArgs): CommandResult {
  if (args.sub === "status") {
    const id = args.rest[0];
    const job = state.jobRunner.listJobs().find((j) => j.id === id);
    if (!job) return fail("not_found", `Job ${id ?? "?"} nicht gefunden`, "Job-IDs über 'jobs list' ermitteln.");
    return ok(job, `Job ${job.id}: Status ${job.status}.`);
  }
  const limit = args.limit ?? DEFAULT_LIMIT;
  const offset = args.offset ?? 0;
  const { slice, page } = paginate(state.jobRunner.listJobs(), offset, limit);
  return ok(slice, listHint(page, "jobs list"), page);
}

async function instancesCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  if (args.sub === "test") {
    const kind = args.rest[0];
    if (kind !== "sonarr" && kind !== "radarr") {
      return fail("missing_argument", "instances test erwartet: sonarr|radarr", "Beispiel: instances test sonarr");
    }
    return testInstance(state, kind);
  }
  return ok(state.instanceStore.list(), "Konfigurierte Instanzen. Erreichbarkeit via 'instances test sonarr|radarr'.");
}

async function testInstance(state: IpcState, kind: InstanceKind): Promise<CommandResult> {
  try {
    const config = state.instanceStore.getWithApiKey(kind);
    const client =
      kind === "sonarr"
        ? new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey })
        : new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
    const status = await client.getStatus();
    return ok({ ok: true, version: status.version, appName: status.appName }, `${kind} erreichbar (${status.version ?? "?"}).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("instance_error", message, "API-Key/Basis-URL in der GUI unter Einstellungen prüfen.");
  }
}

function helpCommand(): CommandResult {
  return ok(
    {
      usage: "arr-cli.exe <verb> [sub] [optionen]",
      commands: {
        "library summary|sonarr|radarr": "Bibliotheksdaten (Listen paginiert, --full für alle Felder, --non-fun-only)",
        "item series|movie <arrId>": "Detail eines Eintrags",
        quota: "Such-/Grab-Quota",
        stats: "Verlaufsstatistik",
        "activity [--limit N]": "Letzte Aktivitäten",
        "jobs list|status <id>": "Jobs auflisten / Status",
        "instances list|test sonarr|radarr": "Instanzen",
        "analyze sonarr|radarr|all [--ids][--sample][--refresh]": "Analyse aktualisieren; --refresh erzwingt Vollprüfung",
        "search sonarr|radarr --ids 1,2,3": "FuN*-Suche auslösen",
        "grab sonarr|radarr --ids 1,2,3": "Kandidaten grabben",
        "missing radarr --ids 1,2,3 [--grab]": "Klassische Radarr-Missing-Suche, optional bester Release-Grab",
        "pipeline sonarr|radarr|all [--ids]": "Analyse+Suche+Grab",
        "automation list|run <goalId>": "Automations-Goals",
        "wanted sonarr|radarr missing|cutoff": "Verfügbare fehlende Titel oder Qualitätsziel-Lücken, --limit/--offset",
        "transfers sonarr|radarr [--refresh]": "Download-/Importstatus; --refresh gleicht mit ARR ab",
        'parse sonarr|radarr "Releasename"': "Namensanalyse ohne Download oder Import",
      },
      globalFlags: ["--pretty", "--quiet", "--full", "--limit N", "--offset N", "--id-type auto|arr|tmdb|tvdb"],
    },
    "Alle Aktionen sind synchron; Ausgabe ist JSON auf stdout, Logs auf stderr.",
  );
}

function listHint(page: { total: number; shown: number; offset: number }, command: string): string {
  const end = page.offset + page.shown;
  if (end < page.total) {
    return `${page.total - end} weitere Einträge — nächste Seite mit '${command} --offset ${end}'.`;
  }
  if (page.total === 0) return "Keine Einträge. Ggf. zuerst 'analyze' ausführen.";
  return `Alle ${page.total} Einträge angezeigt.`;
}

const STATUS_PRIORITY: Record<import("../main/scheduler/job-runner").JobStatus, number> = {
  failed: 5,
  blocked_by_budget: 4,
  cancelled: 3,
  running: 2,
  queued: 1,
  completed: 0,
};

export function combineStatuses(statuses: import("../main/scheduler/job-runner").JobStatus[]): import("../main/scheduler/job-runner").JobStatus {
  return statuses.reduce<import("../main/scheduler/job-runner").JobStatus>(
    (worst, current) => (STATUS_PRIORITY[current] > STATUS_PRIORITY[worst] ? current : worst),
    "completed",
  );
}

export function jobsToActionData(jobs: import("../main/scheduler/job-runner").Job[]): {
  jobIds: string[];
  status: import("../main/scheduler/job-runner").JobStatus;
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
} {
  return {
    jobIds: jobs.map((j) => j.id),
    status: combineStatuses(jobs.map((j) => j.status)),
    processed: jobs.reduce((n, j) => n + j.progressCurrent, 0),
    total: jobs.reduce((n, j) => n + j.progressTotal, 0),
    succeeded: jobs.reduce((n, j) => n + j.successCount, 0),
    failed: jobs.reduce((n, j) => n + j.failureCount, 0),
  };
}

async function awaitJobs(state: IpcState, jobs: import("../main/scheduler/job-runner").Job[]): Promise<import("../main/scheduler/job-runner").Job[]> {
  for (const job of jobs) {
    await state.jobRunner.waitFor(job.id);
  }
  return jobs.map((job) => state.jobRunner.listJobs().find((j) => j.id === job.id) ?? job);
}

function actionHint(verb: string, data: ReturnType<typeof jobsToActionData>): string {
  if (data.status === "blocked_by_budget") return "Quota erschöpft — 'quota' prüfen und später erneut ausführen.";
  if (data.status === "failed") return `Fehlgeschlagen (${data.failed} Fehler). Details siehe stderr-Logs.`;
  if (data.status === "cancelled") return "Job wurde abgebrochen.";
  switch (verb) {
    case "search":
      return `${data.succeeded} Einträge durchsucht. Gefundene Kandidaten mit 'grab' holen (Treffer via 'library --non-fun-only' bzw. 'item' prüfen).`;
    case "grab":
      return `${data.succeeded} Grabs ausgelöst, ${data.failed} fehlgeschlagen.`;
    case "analyze":
      return `${data.succeeded} Einträge analysiert. Sichten mit 'library summary'.`;
    case "pipeline":
      return `Pipeline fertig: ${data.succeeded} erfolgreich, ${data.failed} fehlgeschlagen.`;
    default:
      return "Aktion abgeschlossen.";
  }
}

async function analyzeCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  const {
    enqueueSonarrAnalysis,
    enqueueRadarrAnalysis,
  } = await import("../main/ipc");
  const target = args.sub;
  const radarrIds = target === "radarr" && args.ids.length ? await resolveRadarrMovieIds(state, args.ids, args.idType) : args.ids;
  const jobs: import("../main/scheduler/job-runner").Job[] = [];
  if (target === "sonarr" || target === "all") {
    jobs.push(enqueueSonarrAnalysis(state, "CLI analyze Sonarr", args.ids.length ? args.ids : undefined, args.sample, args.refresh));
  }
  if (target === "radarr" || target === "all") {
    jobs.push(enqueueRadarrAnalysis(state, "CLI analyze Radarr", radarrIds.length ? radarrIds : undefined, args.sample, args.refresh));
  }
  if (jobs.length === 0) {
    return fail("missing_argument", "analyze erwartet: sonarr|radarr|all", "Beispiel: analyze sonarr --sample 50");
  }
  const data = jobsToActionData(await awaitJobs(state, jobs));
  return ok(data, actionHint("analyze", data));
}

async function searchCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  const { enqueueSonarrSearch, enqueueRadarrSearch } = await import("../main/ipc");
  if (args.ids.length === 0) {
    return fail("missing_argument", "search erwartet --ids 1,2,3", "IDs über 'library sonarr|radarr' ermitteln.");
  }
  let job: import("../main/scheduler/job-runner").Job;
  if (args.sub === "sonarr") job = enqueueSonarrSearch(state, { seriesIds: args.ids });
  else if (args.sub === "radarr") job = enqueueRadarrSearch(state, { movieIds: await resolveRadarrMovieIds(state, args.ids, args.idType) });
  else return fail("missing_argument", "search erwartet: sonarr|radarr", "Beispiel: search sonarr --ids 5,8");
  const data = jobsToActionData(await awaitJobs(state, [job]));
  return ok(data, actionHint("search", data));
}

async function grabCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  const { enqueueSonarrGrab, enqueueRadarrGrab } = await import("../main/ipc");
  if (args.ids.length === 0) {
    return fail("missing_argument", "grab erwartet --ids 1,2,3", "Vorher 'search' ausführen, damit Kandidaten gespeichert sind.");
  }
  let job: import("../main/scheduler/job-runner").Job;
  if (args.sub === "sonarr") job = enqueueSonarrGrab(state, { seriesIds: args.ids });
  else if (args.sub === "radarr") job = enqueueRadarrGrab(state, { movieIds: await resolveRadarrMovieIds(state, args.ids, args.idType) });
  else return fail("missing_argument", "grab erwartet: sonarr|radarr", "Beispiel: grab sonarr --ids 5,8");
  const data = jobsToActionData(await awaitJobs(state, [job]));
  return ok(data, actionHint("grab", data));
}

type MissingRadarrItemResult = {
  requestedId: number;
  radarrId?: number;
  title?: string;
  year?: number;
  searched: boolean;
  grabbed: boolean;
  commandId?: number;
  releaseTitle?: string;
  releaseGuid?: string;
  error?: string;
};

function radarrClient(state: IpcState): RadarrClient {
  const config = state.instanceStore.getWithApiKey("radarr");
  return new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
}

/**
 * Übersetzt angefragte IDs (interne Radarr-ID, tmdbId oder aus einer URL extrahierte
 * Zahl) in interne Radarr-`movie.id`s. Unbekannte oder mehrdeutige IDs brechen vor
 * jeder Aktion ab; --id-type erlaubt die eindeutige Wahl des Namensraums.
 */
async function loadRequestedMovies(client: RadarrClient, ids: number[], type: ParsedArgs["idType"]) {
  if (type === "tvdb") throw new Error("Radarr verwendet keine TVDB-IDs");
  return (await mapConcurrent([...new Set(ids)], 4, async (id) => {
    const [internal, external] = await Promise.all([
      type !== "tmdb" ? client.getMovie(id).then((movie) => [movie]).catch((error: unknown) => {
        if (error instanceof Error && error.message.endsWith("returned 404")) return [];
        throw error;
      }) : Promise.resolve([]),
      type !== "arr" ? client.getMoviesByTmdbId(id) : Promise.resolve([]),
    ]);
    return [...internal, ...external];
  })).flat();
}

async function resolveRadarrMovieIds(state: IpcState, requestedIds: number[], type: ParsedArgs["idType"]): Promise<number[]> {
  const movies = await loadRequestedMovies(radarrClient(state), requestedIds, type);
  return [...new Set(requestedIds.map((id) => {
    const movie = resolveMovieIdentity(movies, id, type);
    if (!movie) throw new Error(`Kein Radarr-Film für ${type}-ID ${id}; keine Aktion ausgelöst`);
    return movie.id;
  }))];
}

function missingRadarrHint(data: { searched: number; grabbed: number; failed: number; grab: boolean }): string {
  if (data.grab) {
    return `${data.grabbed} Missing-Movie-Grab(s) ausgelöst, ${data.failed} fehlgeschlagen.`;
  }
  return `${data.searched} Radarr-Missing-Suche(n) ausgelöst, ${data.failed} fehlgeschlagen.`;
}

async function missingCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  if (args.sub !== "radarr") {
    return fail("missing_argument", "missing erwartet aktuell: radarr", "Beispiel: missing radarr --ids 14292 --grab");
  }
  if (args.ids.length === 0) {
    return fail("missing_argument", "missing radarr erwartet --ids 1,2,3", "IDs können auch aus Radarr-URLs kommen, z. B. --ids http://host:7878/movie/14292");
  }

  const client = radarrClient(state);
  const movies = await loadRequestedMovies(client, args.ids, args.idType);
  const resolved = [...new Set(args.ids)].map((id) => ({ id, movie: resolveMovieIdentity(movies, id, args.idType) }));
  const items: MissingRadarrItemResult[] = [];

  for (const { id: requestedId, movie } of resolved) {
    if (!movie) {
      items.push({
        requestedId,
        searched: false,
        grabbed: false,
        error: `No Radarr movie matched requested id ${requestedId} by internal id, tmdbId, or titleSlug`,
      });
      continue;
    }

    const base = {
      requestedId,
      radarrId: movie.id,
      title: movie.title,
      year: movie.year,
    };

    let searched = false;
    try {
      if (!args.grab) {
        const command = await client.runMoviesSearch([movie.id]);
        searched = true;
        items.push({
          ...base,
          searched,
          grabbed: false,
          commandId: typeof command.id === "number" ? command.id : undefined,
        });
        continue;
      }

      const releases = await client.getReleasesForMovie(movie.id);
      searched = true;
      const release = releases.find(isGrabbableRelease);
      if (!release) {
        items.push({
          ...base,
          searched,
          grabbed: false,
          error: `No approved/downloadable Radarr release among ${releases.length} result(s)`,
        });
        continue;
      }

      const config = state.instanceStore.getWithApiKey("radarr");
      const instanceId = state.repositories.instances.upsert({ ...config, kind: "radarr", apiKeyEncrypted: "managed-by-instance-store", enabled: true, now: new Date() });
      const mediaItemId = state.repositories.mediaItems.upsertAnalysis(instanceId, analyzeRadarrMovies([movie]).items[0]);
      const grabbedAt = new Date().toISOString();
      const response = await client.grabRelease(release);
      state.repositories.transfers.record({ instanceId, mediaItemId, childArrId: movie.id,
        title: release.title ?? movie.title, grabbedAt, downloadId: extractDownloadId(response) });
      items.push({
        ...base,
        searched,
        grabbed: true,
        releaseTitle: release.title,
        releaseGuid: release.guid,
      });
    } catch (error) {
      items.push({
        ...base,
        searched,
        grabbed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const data = {
    requested: args.ids.length,
    resolved: items.filter((item) => item.radarrId != null).length,
    searched: items.filter((item) => item.searched).length,
    grabbed: items.filter((item) => item.grabbed).length,
    failed: items.filter((item) => item.error != null).length,
    mode: args.grab ? "interactive-grab" : "missing-search",
    items,
  };

  return ok(data, missingRadarrHint({ ...data, grab: args.grab }));
}

async function pipelineCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  const { enqueueCombinedJob } = await import("../main/ipc");
  const target = args.sub;
  let job: import("../main/scheduler/job-runner").Job;
  if (target === "all") {
    job = enqueueCombinedJob(state, "all");
  } else if (target === "sonarr") {
    job = args.ids.length ? enqueueCombinedJob(state, "selected", { seriesIds: args.ids }) : enqueueCombinedJob(state, "sonarr");
  } else if (target === "radarr") {
    job = args.ids.length ? enqueueCombinedJob(state, "selected", { movieIds: await resolveRadarrMovieIds(state, args.ids, args.idType) }) : enqueueCombinedJob(state, "radarr");
  } else {
    return fail("missing_argument", "pipeline erwartet: sonarr|radarr|all", "Beispiel: pipeline all");
  }
  const data = jobsToActionData(await awaitJobs(state, [job]));
  return ok(data, actionHint("pipeline", data));
}

async function automationCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
  const { createProductionAutomationRunner } = await import("../main/ipc");
  if (args.sub === "run") {
    const goalId = Number(args.rest[0]);
    if (!Number.isInteger(goalId) || goalId <= 0) {
      return fail("missing_argument", "automation run erwartet <goalId>", "Goal-IDs über 'automation list' ermitteln.");
    }
    const run = await createProductionAutomationRunner(state).runGoal(goalId, "manual");
    return ok(run, `Automations-Goal ${goalId} ausgeführt (Status ${(run as { status?: string } | undefined)?.status ?? "?"}).`);
  }
  return ok(state.repositories.automationGoals.list(), "Automations-Goals. Einzeln auslösen via 'automation run <goalId>'.");
}
