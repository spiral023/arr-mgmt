import { Activity, Clapperboard, Pause, Play, Radar, Search, Tv, Zap } from "lucide-react";
import { ActionMenu } from "./ActionMenu";
import { IconButton } from "./IconButton";

export interface CommandBarProps {
  schedulerPaused?: boolean;
  schedulerPending?: boolean;
  onAnalyzeRadarr?: () => void;
  onAnalyzeSonarr?: () => void;
  onGrabRadarr?: () => void;
  onGrabSonarr?: () => void;
  onPauseScheduler?: () => void;
  onQuickSample?: () => void;
  onSearchRadarr?: () => void;
  onSearchSonarr?: () => void;
}

export function CommandBar({
  schedulerPaused = false,
  schedulerPending = false,
  onAnalyzeRadarr,
  onAnalyzeSonarr,
  onGrabRadarr,
  onGrabSonarr,
  onPauseScheduler,
  onQuickSample,
  onSearchRadarr,
  onSearchSonarr,
}: CommandBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <ActionMenu
        icon={Radar}
        label="Analyze libraries"
        shortLabel="Analyze"
        tone="primary"
        items={[
          { icon: Tv, label: "Analyze Sonarr", description: "Full library scan; can take a while", onClick: onAnalyzeSonarr, tone: "primary" },
          { icon: Clapperboard, label: "Analyze Radarr", description: "Full movie scan; can take a while", onClick: onAnalyzeRadarr, tone: "primary" },
          { icon: Activity, label: "Quick sample", description: "One Sonarr and one Radarr item", onClick: onQuickSample },
        ]}
      />
      <ActionMenu
        icon={Search}
        label="Search non-FuN* items"
        shortLabel="Search"
        items={[
          { icon: Tv, label: "Search Sonarr", description: "Use selected rows in Sonarr view", onClick: onSearchSonarr },
          { icon: Clapperboard, label: "Search Radarr", description: "Use selected rows in Radarr view", onClick: onSearchRadarr },
        ]}
      />
      <ActionMenu
        icon={Zap}
        label="Grab available FuN* releases"
        shortLabel="Grab"
        tone="warning"
        items={[
          { icon: Tv, label: "Grab Sonarr", description: "Grab pending Sonarr FuN* candidates", onClick: onGrabSonarr, tone: "warning" },
          { icon: Clapperboard, label: "Grab Radarr", description: "Grab pending Radarr FuN* candidates", onClick: onGrabRadarr, tone: "warning" },
        ]}
      />
      <div aria-hidden="true" className="mx-0.5 h-6 w-px bg-white/[0.08]" />
      <IconButton
        disabled={schedulerPending}
        icon={schedulerPaused ? Play : Pause}
        label={schedulerPaused ? "Resume scheduler" : "Pause scheduler"}
        onClick={onPauseScheduler}
        tone={schedulerPaused ? "success" : "default"}
      >
        {schedulerPaused ? "Resume" : "Pause"}
      </IconButton>
    </div>
  );
}
