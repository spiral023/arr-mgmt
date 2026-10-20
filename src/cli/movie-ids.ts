import type { RadarrMovie } from "../main/arr/arr-types";

export function resolveMovieIdentity(movies: RadarrMovie[], id: number, type: "auto" | "arr" | "tmdb" | "tvdb" = "auto"): RadarrMovie | undefined {
  if (type === "tvdb") throw new Error("Radarr verwendet keine TVDB-IDs; --id-type arr oder tmdb wählen");
  const matches = movies.filter((movie) => type === "arr" ? movie.id === id : type === "tmdb" ? movie.tmdbId === id :
    movie.id === id || movie.tmdbId === id || movie.titleSlug === String(id));
  const unique = [...new Map(matches.map((movie) => [movie.id, movie])).values()];
  if (unique.length > 1) throw new Error(`Mehrdeutige ID ${id}; mit --id-type arr|tmdb den ID-Typ angeben`);
  return unique[0];
}
