import { WorldStore } from "../persistence/worldStore.js";
import { WorldState } from "../interfaces/types.js";
import { createEvent } from "./events/eventFactory.js";

export interface WorldGovernorConfig {
  enabled: boolean;
  intervalMs: number;
  windowEvents: number;
  minPriceMon: number;
  maxPriceMon: number;
}

export class WorldGovernorService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: WorldStore, private readonly config: WorldGovernorConfig) {}

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.runOnce();
      } catch {
        // keep service alive
      }
    }, this.config.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private runOnce(): void {
    this.store.update((state) => {
      ensureEconomyDefaults(state);
      const lastIdx = Math.max(0, state.economy.governor.lastEventIndex ?? 0);
      const events = state.events;
      const slice = events.slice(Math.max(0, events.length - this.config.windowEvents));
      // We use lastEventIndex only to avoid reprocessing if we add future "AI governor" features.
      // The current heuristic governor uses a rolling window (`slice`) to keep behaviour stable.
      void events.slice(lastIdx);

      const rates = computeRates(slice);

      const deltas: string[] = [];
      const market = state.economy.marketPricesMon;
      for (const item of Object.keys(market)) {
        const gathered = rates.gatherByItem[item] ?? 0;
        const current = market[item];
        let next = current;

        // High supply => lower price. Low supply => recover price slowly.
        if (gathered >= 18) {
          next = current * 0.9;
        } else if (gathered <= 4) {
          next = current * 1.04;
        }
        next = clamp(next, this.config.minPriceMon, this.config.maxPriceMon);
        next = round6(next);
        if (Math.abs(next - current) >= 0.0000001) {
          market[item] = next;
          deltas.push(`${item} ${fmt(current)}->${fmt(next)} (gather=${gathered})`);
        }
      }

      const attacks = rates.attackCount;
      const aids = rates.aidCount;
      const trades = rates.tradeCount;

      const basePenalty = round6(Math.max(0, state.economy.attackPenaltyMon));
      let nextPenalty = basePenalty;
      if (attacks >= 3) {
        nextPenalty = round6(clamp(basePenalty * 1.25, 0, 0.01));
      } else if (attacks === 0) {
        nextPenalty = round6(clamp(basePenalty * 0.97, 0, 0.01));
      }
      if (nextPenalty !== basePenalty) {
        state.economy.attackPenaltyMon = nextPenalty;
        deltas.push(`attackPenalty ${fmt(basePenalty)}->${fmt(nextPenalty)} (attacks=${attacks})`);
      }

      // Make "helping" more valuable when conflict is high.
      const baseAidRep = Math.max(0, Math.floor(state.economy.aidReputationReward));
      let nextAidRep = baseAidRep;
      if (attacks >= 3 && aids < attacks) nextAidRep = clampInt(baseAidRep + 1, 1, 6);
      if (attacks === 0 && baseAidRep > 2) nextAidRep = clampInt(baseAidRep - 1, 2, 6);
      if (nextAidRep !== baseAidRep) {
        state.economy.aidReputationReward = nextAidRep;
        deltas.push(`aidRep ${baseAidRep}->${nextAidRep}`);
      }

      const baseTradeRep = Math.max(0, Math.floor(state.economy.tradeReputationReward));
      let nextTradeRep = baseTradeRep;
      if (trades < 2 && attacks >= 2) nextTradeRep = clampInt(baseTradeRep + 1, 1, 5);
      if (trades >= 6 && baseTradeRep > 1) nextTradeRep = clampInt(baseTradeRep - 1, 1, 5);
      if (nextTradeRep !== baseTradeRep) {
        state.economy.tradeReputationReward = nextTradeRep;
        deltas.push(`tradeRep ${baseTradeRep}->${nextTradeRep}`);
      }

      state.economy.governor.lastEventIndex = events.length;
      state.economy.governor.lastRunAt = new Date().toISOString();

      // Only emit an event if something changed, otherwise keep noise low.
      if (deltas.length > 0) {
        state.tick += 1;
        state.events.push(
          createEvent(
            state.events.length + 1,
            state.tick,
            "world",
            "world_governor",
            `Governor adjusted economy: ${deltas.join("; ")}`
          )
        );
      }
    });
  }
}

function ensureEconomyDefaults(state: WorldState): void {
  if (!state.economy) {
    (state as any).economy = {
      marketPricesMon: { wood: 0.000001, herb: 0.0000015, ore: 0.000002, crystal: 0.000003, coin: 0.0000008 },
      attackPenaltyMon: 0.000001,
      tradeReputationReward: 1,
      aidReputationReward: 2,
      governor: { lastEventIndex: 0, lastRunAt: new Date(0).toISOString() }
    };
    return;
  }
  state.economy.marketPricesMon = state.economy.marketPricesMon ?? {};
  for (const [k, v] of Object.entries({ wood: 0.000001, herb: 0.0000015, ore: 0.000002, crystal: 0.000003, coin: 0.0000008 })) {
    if (typeof state.economy.marketPricesMon[k] !== "number") state.economy.marketPricesMon[k] = v;
  }
  if (typeof state.economy.attackPenaltyMon !== "number") state.economy.attackPenaltyMon = 0.000001;
  if (typeof state.economy.tradeReputationReward !== "number") state.economy.tradeReputationReward = 1;
  if (typeof state.economy.aidReputationReward !== "number") state.economy.aidReputationReward = 2;
  state.economy.governor = state.economy.governor ?? { lastEventIndex: 0, lastRunAt: new Date(0).toISOString() };
  if (typeof state.economy.governor.lastEventIndex !== "number") state.economy.governor.lastEventIndex = 0;
  if (typeof state.economy.governor.lastRunAt !== "string") state.economy.governor.lastRunAt = new Date(0).toISOString();
}

function computeRates(events: Array<{ type?: string; message?: string }>): {
  gatherByItem: Record<string, number>;
  attackCount: number;
  tradeCount: number;
  aidCount: number;
} {
  const gatherByItem: Record<string, number> = {};
  let attackCount = 0;
  let tradeCount = 0;
  let aidCount = 0;

  for (const e of events) {
    const t = String(e.type || "").toLowerCase();
    if (t === "attack") attackCount += 1;
    if (t === "trade") tradeCount += 1;
    if (t === "aid") aidCount += 1;
    if (t === "gather") {
      const msg = String(e.message || "");
      // Parse "(+wood:2 +herb:1)" fragments.
      const matches = msg.match(/\+([a-zA-Z_]+):([0-9]+)/g) || [];
      for (const m of matches) {
        const mm = m.match(/\+([a-zA-Z_]+):([0-9]+)/);
        if (!mm) continue;
        const item = mm[1].toLowerCase();
        const qty = Number(mm[2]);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        gatherByItem[item] = (gatherByItem[item] || 0) + qty;
      }
    }
  }

  return { gatherByItem, attackCount, tradeCount, aidCount };
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function clampInt(v: number, min: number, max: number): number {
  const x = Math.floor(v);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function round6(v: number): number {
  return Number(v.toFixed(6));
}

function fmt(v: number): string {
  // Prices are often below 1e-6; show more precision than balances.
  const n = Number.isFinite(v) ? v : 0;
  return n.toFixed(9);
}
