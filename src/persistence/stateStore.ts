import fs from "node:fs";
import path from "node:path";
import { WorldState, parseWorldState } from "../interfaces/types.js";
import { WorldStore } from "./worldStore.js";

const DEFAULT_STATE: WorldState = {
  tick: 0,
  agents: {},
  wallets: {},
  events: [],
  processedPaymentTxHashes: [],
  governance: {
    activePolicy: "neutral",
    votes: {
      neutral: 0,
      cooperative: 0,
      aggressive: 0
    }
  }
};

export class StateStore implements WorldStore {
  private readonly lockFile: string;
  private static readonly STALE_LOCK_MS = 30_000;

  constructor(private readonly stateFile: string) {
    this.lockFile = `${stateFile}.lock`;
  }

  initFromSeed(seedFile: string): WorldState {
    if (!fs.existsSync(this.stateFile)) {
      const seed = this.parseWorldState(this.readJson(seedFile));
      this.write(seed);
      return seed;
    }

    return this.read();
  }

  read(): WorldState {
    if (!fs.existsSync(this.stateFile)) {
      return structuredClone(DEFAULT_STATE);
    }

    return this.parseWorldState(this.readJson(this.stateFile));
  }

  write(state: WorldState): void {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const safeState = this.parseWorldState(state);
    const tempPath = `${this.stateFile}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(safeState, null, 2), "utf-8");
    fs.renameSync(tempPath, this.stateFile);
  }

  update<T>(mutator: (state: WorldState) => T): T {
    const lockFd = this.acquireLock();
    try {
      const state = this.read();
      const result = mutator(state);
      this.write(state);
      return result;
    } finally {
      fs.closeSync(lockFd);
      fs.unlinkSync(this.lockFile);
    }
  }

  private readJson(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }

  private parseWorldState(input: unknown): WorldState {
    return parseWorldState(input);
  }

  private acquireLock(): number {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const maxAttempts = 50;
    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        return fs.openSync(this.lockFile, "wx");
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "EEXIST") {
          throw error;
        }

        // Recover from abandoned lock files (e.g. prior crash/forced stop).
        try {
          const lockStat = fs.statSync(this.lockFile);
          if (Date.now() - lockStat.mtimeMs > StateStore.STALE_LOCK_MS) {
            fs.unlinkSync(this.lockFile);
            continue;
          }
        } catch (statError) {
          const statErr = statError as NodeJS.ErrnoException;
          if (statErr.code !== "ENOENT") {
            throw statError;
          }
        }

        const start = Date.now();
        while (Date.now() - start < 10) {
          // Intentional short spin-wait to avoid adding async complexity.
        }
      }
    }
    throw new Error("Failed to acquire state lock");
  }
}
