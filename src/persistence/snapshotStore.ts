import fs from "node:fs";
import path from "node:path";
import { WorldState } from "../interfaces/types.js";

export class SnapshotStore {
  constructor(private readonly snapshotDir: string) {}

  save(state: WorldState): string {
    fs.mkdirSync(this.snapshotDir, { recursive: true });
    const fileName = `snapshot-t${state.tick}-${Date.now()}.json`;
    const fullPath = path.join(this.snapshotDir, fileName);
    fs.writeFileSync(fullPath, JSON.stringify(state, null, 2), "utf-8");
    return fullPath;
  }
}
