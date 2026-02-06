import { StateStore } from "./stateStore.js";
import { SqliteStateStore } from "./sqliteStateStore.js";
import { WorldStore } from "./worldStore.js";

export function createWorldStore(jsonPath: string, sqlitePath: string): WorldStore {
  const mode = (process.env.WORLD_STORE ?? "json").toLowerCase();
  if (mode === "sqlite") {
    return new SqliteStateStore(sqlitePath);
  }

  return new StateStore(jsonPath);
}
