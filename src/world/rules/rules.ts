import { LocationId } from "../../interfaces/types.js";
import { LOCATION_GRAPH } from "../locations/map.js";

export function canMove(from: LocationId, to: LocationId): boolean {
  return LOCATION_GRAPH[from].includes(to);
}

export function gatherYield(location: LocationId): Record<string, number> {
  if (location === "forest") return { wood: 2, herb: 1 };
  if (location === "cavern") return { ore: 2, crystal: 1 };
  return { coin: 1 };
}
