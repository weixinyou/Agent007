import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { WorldState, parseWorldState } from "../interfaces/types.js";
import { WorldStore } from "./worldStore.js";

interface StateRow {
  payload: string;
}

interface SqliteDatabase {
  pragma(statement: string): void;
  exec(sql: string): void;
  prepare(sql: string): {
    get(): unknown;
    run(...args: unknown[]): unknown;
  };
  transaction<T>(fn: (mutator: (state: WorldState) => T) => T): (mutator: (state: WorldState) => T) => T;
}

export class SqliteStateStore implements WorldStore {
  private readonly db: SqliteDatabase;

  constructor(private readonly dbFile: string) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const require = createRequire(import.meta.url);
    let BetterSqlite3: (new (filename: string) => SqliteDatabase) | undefined;
    try {
      BetterSqlite3 = require("better-sqlite3") as new (filename: string) => SqliteDatabase;
    } catch {
      throw new Error(
        "SQLite mode requires better-sqlite3. Install it with: npm install better-sqlite3"
      );
    }
    this.db = new BetterSqlite3(dbFile);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL
      );
    `);
  }

  initFromSeed(seedFile: string): WorldState {
    const existing = this.getRow();
    if (existing) {
      return this.parsePayload(existing.payload);
    }

    const seed = parseWorldState(JSON.parse(fs.readFileSync(seedFile, "utf-8")));
    this.write(seed);
    return seed;
  }

  read(): WorldState {
    const row = this.getRow();
    if (!row) {
      // Use parser to populate defaults (economy/telemetry) for empty DBs.
      return parseWorldState({
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
      });
    }

    return this.parsePayload(row.payload);
  }

  write(state: WorldState): void {
    const safeState = parseWorldState(state);
    const payload = JSON.stringify(safeState);
    this.db
      .prepare(`
        INSERT INTO world_state (id, payload)
        VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
      `)
      .run(payload);
  }

  update<T>(mutator: (state: WorldState) => T): T {
    const tx = this.db.transaction((fn: (state: WorldState) => T): T => {
      const state = this.read();
      const result = fn(state);
      this.write(state);
      return result;
    });
    return tx(mutator);
  }

  private getRow(): StateRow | undefined {
    return this.db.prepare("SELECT payload FROM world_state WHERE id = 1").get() as StateRow | undefined;
  }

  private parsePayload(payload: string): WorldState {
    return parseWorldState(JSON.parse(payload));
  }
}
