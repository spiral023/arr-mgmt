import {
  formatActivityRow,
  formatRadarrRowDates,
  formatSonarrRowDates,
  getQuotaSummary,
  type IpcState,
} from "../main/ipc";
import { SonarrClient } from "../main/arr/sonarr-client";
import { RadarrClient } from "../main/arr/radarr-client";
import type { InstanceKind } from "../shared/ipc-contracts";
import type { ParsedArgs } from "./args";
import { fail, ok, paginate, pickFields, type CommandResult } from "./output";

export const DEFAULT_LIMIT = 20;

export const SONARR_LIST_FIELDS = ["arrId", "title", "status", "monitored", "nonFunFiles", "funShare"] as const;
export const RADARR_LIST_FIELDS = ["arrId", "title", "year", "status", "monitored", "nonFunFiles", "funShare"] as const;

export async function runCommand(state: IpcState, args: ParsedArgs): Promise<CommandResult> {
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
    case "automation":
      return automationCommand(state, args);
    case "help":
      return helpCommand();
    default:
      return fail("unknown_command", `Unbekannter Befehl: ${args.verb}`, "Verfügbare Befehle mit 'help' anzeigen.");
  }
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
      usage: 'arr-cli <verb> [sub] [optionen]  |  "ARR Ops.exe" --cli <verb> ...',
      commands: {
        "library summary|sonarr|radarr": "Bibliotheksdaten (Listen paginiert, --full für alle Felder, --non-fun-only)",
        "item series|movie <arrId>": "Detail eines Eintrags",
        quota: "Such-/Grab-Quota",
        stats: "Verlaufsstatistik",
        "activity [--limit N]": "Letzte Aktivitäten",
        "jobs list|status <id>": "Jobs auflisten / Status",
        "instances list|test sonarr|radarr": "Instanzen",
        "analyze sonarr|radarr|all [--ids][--sample]": "Analyse auslösen",
        "search sonarr|radarr --ids 1,2,3": "FuN*-Suche auslösen",
        "grab sonarr|radarr --ids 1,2,3": "Kandidaten grabben",
        "pipeline sonarr|radarr|all [--ids]": "Analyse+Suche+Grab",
        "automation list|run <goalId>": "Automations-Goals",
      },
      globalFlags: ["--pretty", "--quiet", "--full", "--limit N", "--offset N"],
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
  const jobs: import("../main/scheduler/job-runner").Job[] = [];
  if (target === "sonarr" || target === "all") {
    jobs.push(enqueueSonarrAnalysis(state, "CLI analyze Sonarr", args.ids.length ? args.ids : undefined, args.sample));
  }
  if (target === "radarr" || target === "all") {
    jobs.push(enqueueRadarrAnalysis(state, "CLI analyze Radarr", args.ids.length ? args.ids : undefined, args.sample));
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
  else if (args.sub === "radarr") job = enqueueRadarrSearch(state, { movieIds: args.ids });
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
  else if (args.sub === "radarr") job = enqueueRadarrGrab(state, { movieIds: args.ids });
  else return fail("missing_argument", "grab erwartet: sonarr|radarr", "Beispiel: grab sonarr --ids 5,8");
  const data = jobsToActionData(await awaitJobs(state, [job]));
  return ok(data, actionHint("grab", data));
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
    job = args.ids.length ? enqueueCombinedJob(state, "selected", { movieIds: args.ids }) : enqueueCombinedJob(state, "radarr");
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
