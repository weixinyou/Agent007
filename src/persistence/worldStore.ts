import { WorldState } from "../interfaces/types.js";

export interface WorldStore {
  initFromSeed(seedFile: string): WorldState;
  read(): WorldState;
  write(state: WorldState): void;
  update<T>(mutator: (state: WorldState) => T): T;
}
