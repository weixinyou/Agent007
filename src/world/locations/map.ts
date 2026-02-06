import { LocationId } from "../../interfaces/types.js";

export const LOCATION_GRAPH: Record<LocationId, LocationId[]> = {
  town: ["forest"],
  forest: ["town", "cavern"],
  cavern: ["forest"]
};
