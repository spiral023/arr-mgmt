import type { ArrRelease } from "./arr-types";
import { isGrabbableRelease, selectBestFunRelease } from "./sonarr-operations";
import { isFunReleaseGroup } from "../../shared/fun";

export type GrabTarget = { release: ArrRelease; strategy: "guid" | "title" | "best-fun" };

/** A season response contains other episodes: replacements require a fresh per-item search. */
export function resolveGrabTarget(
  fresh: ArrRelease[],
  stored: ArrRelease,
  scope: "season" | "item",
): GrabTarget | undefined {
  const allowed = fresh.filter((release) => isFunReleaseGroup(release.releaseGroup) && isGrabbableRelease(release));
  const sameIndexer = (release: ArrRelease) => {
    if (typeof stored.indexerId === "number") return release.indexerId === stored.indexerId;
    return !stored.indexer || release.indexer === stored.indexer;
  };
  if (stored.guid) {
    const release = allowed.find((item) => item.guid === stored.guid && sameIndexer(item));
    if (release) return { release, strategy: "guid" };
  }
  if (stored.title) {
    const release = allowed.find((item) => item.title === stored.title && sameIndexer(item));
    if (release) return { release, strategy: "title" };
  }
  if (scope === "season") return undefined;
  const release = selectBestFunRelease(allowed);
  return release ? { release, strategy: "best-fun" } : undefined;
}
