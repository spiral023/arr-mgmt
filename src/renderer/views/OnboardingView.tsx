import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Clapperboard, KeyRound, PlayCircle, Save, Tv } from "lucide-react";
import { IconButton } from "../components/IconButton";
import type { InstanceConfigInput } from "../../shared/ipc-contracts";

const fieldClassName =
  "h-10 w-full rounded-md border border-white/10 bg-ink-950 px-3 text-sm text-ink-200 outline-none shadow-surface transition-[background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-ink-400 focus:border-signal-cyan focus:ring-2 focus:ring-signal-cyan/30";

export function OnboardingView({
  onAnalyzeAll,
  onComplete,
  onQuickSample,
  onSaveInstance,
}: {
  onAnalyzeAll: () => void;
  onComplete: () => void;
  onQuickSample: () => void;
  onSaveInstance: (input: InstanceConfigInput) => Promise<unknown>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [message, setMessage] = useState("Enter your local Sonarr and Radarr connection details.");
  const [sonarr, setSonarr] = useState({ apiKey: "", baseUrl: "http://localhost:8989", name: "Sonarr" });
  const [radarr, setRadarr] = useState({ apiKey: "", baseUrl: "http://localhost:7878", name: "Radarr" });

  async function saveConnections() {
    setMessage("Saving ARR connections...");
    await onSaveInstance({ kind: "sonarr", ...sonarr, enabled: true });
    await onSaveInstance({ kind: "radarr", ...radarr, enabled: true });
    setMessage("Connections saved. Choose an initial workflow.");
    setStep(2);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-ink-950/90 p-4 backdrop-blur">
      <div className="mx-auto mt-8 max-w-4xl rounded-lg bg-ink-900 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">ARR Ops Setup</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-400">
              Analysen, Suchen und Grabs koennen je nach Bibliotheksgroesse laenger dauern. Starte mit einem kleinen Sample, wenn du die Verbindung erst testen willst.
            </p>
          </div>
          <span className="rounded-md bg-ink-950 px-3 py-1 text-xs font-semibold text-ink-400 shadow-surface">Step {step} / 2</span>
        </div>

        <div className="mt-4 rounded-md bg-ink-950/70 px-3 py-2 text-sm text-ink-200 shadow-surface">{message}</div>

        {step === 1 ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <InstanceSetup icon={Tv} label="Sonarr" values={sonarr} onChange={setSonarr} />
            <InstanceSetup icon={Clapperboard} label="Radarr" values={radarr} onChange={setRadarr} />
            <div className="lg:col-span-2">
              <IconButton icon={Save} label="Save ARR connections" onClick={() => void saveConnections()} tone="success">
                Save and continue
              </IconButton>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <WorkflowCard
              description="Read full Sonarr and Radarr libraries and build baseline FuN* coverage. This can take a long time."
              icon={PlayCircle}
              label="Analyze libraries"
              onClick={() => {
                onAnalyzeAll();
                onComplete();
              }}
            />
            <WorkflowCard
              description="Read one item from Sonarr and one from Radarr, then search and grab later from the tables."
              icon={KeyRound}
              label="Quick sample"
              onClick={() => {
                onQuickSample();
                onComplete();
              }}
            />
            <WorkflowCard description="Close setup and configure or run jobs manually from the app." icon={Save} label="Finish setup" onClick={onComplete} />
          </div>
        )}
      </div>
    </div>
  );
}

function InstanceSetup({
  icon: Icon,
  label,
  onChange,
  values,
}: {
  icon: LucideIcon;
  label: string;
  onChange: (values: { apiKey: string; baseUrl: string; name: string }) => void;
  values: { apiKey: string; baseUrl: string; name: string };
}) {
  return (
    <section className="rounded-lg bg-ink-950/60 p-4 shadow-surface">
      <div className="flex items-center gap-2 text-white">
        <Icon aria-hidden="true" className="h-4 w-4 text-signal-cyan" />
        <span className="font-semibold">{label}</span>
      </div>
      <div className="mt-4 grid gap-3">
        <label>
          <Label>Name</Label>
          <input className={fieldClassName} onChange={(event) => onChange({ ...values, name: event.target.value })} value={values.name} />
        </label>
        <label>
          <Label>Base URL</Label>
          <input className={fieldClassName} onChange={(event) => onChange({ ...values, baseUrl: event.target.value })} value={values.baseUrl} />
        </label>
        <label>
          <Label>API key</Label>
          <input className={fieldClassName} onChange={(event) => onChange({ ...values, apiKey: event.target.value })} type="password" value={values.apiKey} />
        </label>
      </div>
    </section>
  );
}

function WorkflowCard({
  description,
  icon: Icon,
  label,
  onClick,
}: {
  description: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="min-h-40 rounded-lg bg-ink-950/70 p-4 text-left shadow-surface outline-none transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-white/[0.05] hover:shadow-surface-hover focus-visible:ring-2 focus-visible:ring-signal-cyan/30 active:scale-[0.96]"
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="h-5 w-5 text-signal-cyan" />
      <span className="mt-4 block text-base font-semibold text-white">{label}</span>
      <span className="mt-2 block text-sm text-ink-400">{description}</span>
    </button>
  );
}

function Label({ children }: { children: string }) {
  return <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">{children}</span>;
}
