import { Bell, Clock3, Database, KeyRound, Save, Shield, Timer, Wifi } from "lucide-react";
import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import { IconButton } from "../components/IconButton";
import { StatusPill } from "../components/StatusPill";
import { getSettings, listInstances, saveInstance, testInstance, updateAppSettings } from "../state/ipc-client";
import type { InstanceConfigInput, InstanceConfigView, InstanceKind } from "../../shared/ipc-contracts";

const fieldClassName =
  "h-10 w-full rounded-md border border-white/10 bg-ink-950 px-3 text-sm text-ink-200 outline-none shadow-surface transition-[background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-ink-400 focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30";

const sectionClassName = "rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface";

export function SettingsView() {
  const [instances, setInstances] = useState<InstanceConfigView[]>([]);
  const [candidatesFoundNotifications, setCandidatesFoundNotifications] = useState(true);
  const [episodeCooldown, setEpisodeCooldown] = useState(24);
  const [funDisplayName, setFunDisplayName] = useState("FuN*");
  const [funPrefixes, setFunPrefixes] = useState("fun");
  const [grabLimit, setGrabLimit] = useState(400);
  const [jobFinishedNotifications, setJobFinishedNotifications] = useState(true);
  const [keepRunningOnClose, setKeepRunningOnClose] = useState(true);
  const [movieCooldown, setMovieCooldown] = useState(24);
  const [message, setMessage] = useState("Ready");
  const [quotaExhaustedNotifications, setQuotaExhaustedNotifications] = useState(true);
  const [searchLimit, setSearchLimit] = useState(2000);
  const [showTrayControls, setShowTrayControls] = useState(true);

  useEffect(() => {
    void getSettings().then((settings) => {
      setInstances(settings.instances);
      setCandidatesFoundNotifications(settings.appSettings.notifications.candidatesFound);
      setEpisodeCooldown(settings.appSettings.cooldownHours.episodeSearch);
      setFunDisplayName(settings.appSettings.fun.displayName);
      setFunPrefixes(settings.appSettings.fun.prefixes.join(", "));
      setGrabLimit(settings.appSettings.quota.grabLimit);
      setJobFinishedNotifications(settings.appSettings.notifications.jobFinished);
      setKeepRunningOnClose(settings.appSettings.tray.keepRunningOnClose);
      setMovieCooldown(settings.appSettings.cooldownHours.movieSearch);
      setQuotaExhaustedNotifications(settings.appSettings.notifications.quotaExhausted);
      setSearchLimit(settings.appSettings.quota.searchLimit);
      setShowTrayControls(settings.appSettings.tray.showControls);
    });
  }, []);

  async function handleSave(input: InstanceConfigInput) {
    setMessage(`Saving ${input.kind}...`);
    try {
      await saveInstance(input);
      setInstances(await listInstances());
      setMessage(`${input.name} saved`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleTest(input: InstanceConfigInput) {
    setMessage(`Testing ${input.kind}...`);
    const result = await testInstance(input);
    setMessage(result.ok ? `Connection OK: ${result.message}` : `Connection failed: ${result.message}`);
  }

  async function handleSaveGeneralSettings() {
    setMessage("Saving general settings...");
    try {
      const saved = await updateAppSettings({
        cooldownHours: { episodeSearch: episodeCooldown, movieSearch: movieCooldown },
        fun: { displayName: funDisplayName, prefixes: funPrefixes.split(",") },
        notifications: {
          candidatesFound: candidatesFoundNotifications,
          jobFinished: jobFinishedNotifications,
          quotaExhausted: quotaExhaustedNotifications,
        },
        quota: { grabLimit, searchLimit, windowHours: 24 },
        tray: { keepRunningOnClose, showControls: showTrayControls },
      });
      setEpisodeCooldown(saved.cooldownHours.episodeSearch);
      setMovieCooldown(saved.cooldownHours.movieSearch);
      setFunPrefixes(saved.fun.prefixes.join(", "));
      setGrabLimit(saved.quota.grabLimit);
      setSearchLimit(saved.quota.searchLimit);
      setMessage("General settings saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const sonarr = instances.find((instance) => instance.kind === "sonarr");
  const radarr = instances.find((instance) => instance.kind === "radarr");

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className={sectionClassName}>
        <Header icon={Database} title="ARR Instances" description="Store Sonarr and Radarr connection details locally. API keys are encrypted by Electron safeStorage." />
        <div className="mt-3 rounded-md border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-200 shadow-surface">
          {message}
        </div>
        <div className="mt-4 grid gap-4">
          <InstanceForm
            apiKeyPlaceholder="Stored in encrypted local storage"
            baseUrl={sonarr?.baseUrl ?? "http://192.168.0.170:8989"}
            hasApiKey={sonarr?.hasApiKey ?? false}
            kind="sonarr"
            name={sonarr?.name ?? "Sonarr"}
            onSave={handleSave}
            onTest={handleTest}
            status={sonarr?.hasApiKey ? "configured" : "missing key"}
          />
          <InstanceForm
            apiKeyPlaceholder="Stored in encrypted local storage"
            baseUrl={radarr?.baseUrl ?? "http://192.168.0.170:7878"}
            hasApiKey={radarr?.hasApiKey ?? false}
            kind="radarr"
            name={radarr?.name ?? "Radarr"}
            onSave={handleSave}
            onTest={handleTest}
            status={radarr?.hasApiKey ? "configured" : "missing key"}
          />
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <section className={sectionClassName}>
          <Header icon={Shield} title="FuN* Matching" description="Prefixes are evaluated case-insensitively against releaseGroup." />
          <div className="mt-4 grid gap-3">
            <label>
              <Label>Display name</Label>
              <input className={fieldClassName} onChange={(event) => setFunDisplayName(event.target.value)} value={funDisplayName} />
            </label>
            <label>
              <Label>Prefixes</Label>
              <input className={fieldClassName} onChange={(event) => setFunPrefixes(event.target.value)} value={funPrefixes} />
            </label>
          </div>
        </section>

        <section className={sectionClassName}>
          <Header icon={Timer} title="Shared Rolling 24h Budgets" description="Budgets apply to Sonarr and Radarr together." />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <Label>Search limit</Label>
              <input className={fieldClassName} min={1} onChange={(event) => setSearchLimit(Number(event.target.value))} type="number" value={searchLimit} />
            </label>
            <label>
              <Label>Grab limit</Label>
              <input className={fieldClassName} min={1} onChange={(event) => setGrabLimit(Number(event.target.value))} type="number" value={grabLimit} />
            </label>
          </div>
        </section>

        <section className={sectionClassName}>
          <Header icon={Clock3} title="Cooldowns" description="Avoid repeated searches before indexers have had time to change." />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <Label>Episode search cooldown</Label>
              <select className={fieldClassName} onChange={(event) => setEpisodeCooldown(Number(event.target.value))} value={episodeCooldown}>
                <option value="6">6 hours</option>
                <option value="12">12 hours</option>
                <option value="24">24 hours</option>
                <option value="48">48 hours</option>
              </select>
            </label>
            <label>
              <Label>Movie search cooldown</Label>
              <select className={fieldClassName} onChange={(event) => setMovieCooldown(Number(event.target.value))} value={movieCooldown}>
                <option value="6">6 hours</option>
                <option value="12">12 hours</option>
                <option value="24">24 hours</option>
                <option value="48">48 hours</option>
              </select>
            </label>
          </div>
        </section>
      </div>

      <section className={sectionClassName}>
        <Header icon={Clock3} title="Schedules" description="Scheduled jobs can run analysis, search, grab, or a combined workflow." />
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_11rem_10rem]">
          <label>
            <Label>Name</Label>
            <input className={fieldClassName} defaultValue="Nightly FuN completion" />
          </label>
          <label>
            <Label>Interval</Label>
            <select className={fieldClassName} defaultValue="daily_time">
              <option value="minutes">Every X minutes</option>
              <option value="hours">Every X hours</option>
              <option value="days">Every X days</option>
              <option value="daily_time">Daily at time</option>
            </select>
          </label>
          <label>
            <Label>Time / value</Label>
            <input className={fieldClassName} defaultValue="03:30" />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-ink-200">
          <Check label="Analysis" />
          <Check label="Search" />
          <Check label="Grab" />
          <Check label="Sonarr" />
          <Check label="Radarr" />
        </div>
      </section>

      <section className={sectionClassName}>
        <Header icon={Bell} title="Notifications and Tray" description="The app is designed to stay resident and report important job outcomes." />
        <div className="mt-4 grid gap-3">
          <Check checked={jobFinishedNotifications} label="Show Windows notifications when jobs finish" onChange={setJobFinishedNotifications} />
          <Check checked={quotaExhaustedNotifications} label="Notify when quota is exhausted" onChange={setQuotaExhaustedNotifications} />
          <Check checked={candidatesFoundNotifications} label="Notify when FuN* candidates are found" onChange={setCandidatesFoundNotifications} />
          <Check checked={keepRunningOnClose} label="Keep app running when the window is closed" onChange={setKeepRunningOnClose} />
          <Check checked={showTrayControls} label="Show tray controls for analysis and scheduler pause" onChange={setShowTrayControls} />
        </div>
      </section>

      <div className="xl:col-span-2">
        <IconButton icon={Save} label="Save settings" onClick={() => void handleSaveGeneralSettings()} tone="success">
          Save general settings
        </IconButton>
      </div>
    </div>
  );
}

function InstanceForm({
  apiKeyPlaceholder,
  baseUrl,
  hasApiKey,
  kind,
  name,
  onSave,
  onTest,
  status,
}: {
  apiKeyPlaceholder: string;
  baseUrl: string;
  hasApiKey: boolean;
  kind: InstanceKind;
  name: string;
  onSave: (input: InstanceConfigInput) => Promise<void>;
  onTest: (input: InstanceConfigInput) => Promise<void>;
  status: "configured" | "missing key";
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftBaseUrl, setDraftBaseUrl] = useState(baseUrl);
  const [draftApiKey, setDraftApiKey] = useState("");
  const label = kind === "sonarr" ? "Sonarr" : "Radarr";

  useEffect(() => {
    setDraftName(name);
    setDraftBaseUrl(baseUrl);
  }, [baseUrl, name]);

  const payload = (): InstanceConfigInput => ({
    kind,
    name: draftName,
    baseUrl: draftBaseUrl,
    apiKey: draftApiKey || undefined,
    enabled: true,
  });

  return (
    <div className="rounded-lg border border-white/10 bg-ink-950/55 p-4 shadow-surface">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wifi aria-hidden="true" className="h-4 w-4 text-signal-cyan" />
          <span className="font-semibold text-white">{label}</span>
        </div>
        <StatusPill tone={status === "configured" ? "success" : "warning"}>{status}</StatusPill>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[10rem_1fr]">
        <label>
          <Label>Name</Label>
          <input className={fieldClassName} onChange={(event) => setDraftName(event.target.value)} value={draftName} />
        </label>
        <label>
          <Label>Base URL</Label>
          <input className={fieldClassName} onChange={(event) => setDraftBaseUrl(event.target.value)} value={draftBaseUrl} />
        </label>
        <label className="md:col-span-2">
          <Label>API key</Label>
          <div className="flex gap-2">
            <input
              className={fieldClassName}
              onChange={(event) => setDraftApiKey(event.target.value)}
              placeholder={hasApiKey ? "Saved API key is encrypted. Enter a new key to replace it." : apiKeyPlaceholder}
              type="password"
              value={draftApiKey}
            />
            <IconButton className="shrink-0" icon={KeyRound} label={`Test ${label} connection`} onClick={() => void onTest(payload())}>
              Test
            </IconButton>
            <IconButton className="shrink-0" icon={Save} label={`Save ${label} settings`} onClick={() => void onSave(payload())} tone="success">
              Save
            </IconButton>
          </div>
        </label>
      </div>
    </div>
  );
}

function Header({ description, icon: Icon, title }: { description: string; icon: typeof Database; title: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-ink-950 text-signal-cyan shadow-surface">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-ink-400">{description}</p>
      </div>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">{children}</span>;
}

function Check({ checked, label, onChange }: { checked?: boolean; label: string; onChange?: (checked: boolean) => void }) {
  const checkboxProps =
    typeof checked === "boolean" && onChange
      ? { checked, onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked) }
      : { defaultChecked: true };
  return (
    <label className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-ink-950/70 px-3 shadow-surface">
      <input className="h-4 w-4 rounded border-white/20 bg-ink-950 accent-signal-cyan" type="checkbox" {...checkboxProps} />
      <span>{label}</span>
    </label>
  );
}
