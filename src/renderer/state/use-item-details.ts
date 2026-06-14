import { useEffect, useState } from "react";
import { getItemDetails } from "./ipc-client";
import type { MediaItemDetails } from "../../shared/ipc-contracts";

export type ItemDetailsLoader = (kind: "series" | "movie", arrId: number) => Promise<MediaItemDetails>;

export function useItemDetails(
  kind: "series" | "movie",
  arrId: number | null,
  loader: ItemDetailsLoader = getItemDetails,
): { details: MediaItemDetails | null; loading: boolean } {
  const [details, setDetails] = useState<MediaItemDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (arrId === null) {
      setDetails(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setDetails(null);
    loader(kind, arrId)
      .then((result) => {
        if (active) setDetails(result);
      })
      .catch(() => {
        if (active) setDetails(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [kind, arrId, loader]);

  return { details, loading };
}
