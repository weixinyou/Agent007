export type LocationId = "town" | "forest" | "cavern";
export type ActionType = "move" | "gather" | "rest" | "trade" | "attack" | "vote" | "claim" | "sell" | "aid";
export type VotePolicy = "neutral" | "cooperative" | "aggressive";

export interface Wallet {
  address: string;
  monBalance: number;
}

export interface AgentState {
  id: string;
  walletAddress: string;
  enteredAt: string;
  location: LocationId;
  energy: number;
  inventory: Record<string, number>;
  reputation: number;
}

export interface WorldEvent {
  id: string;
  at: string;
  agentId: string;
  type: string;
  message: string;
}

export interface WorldState {
  tick: number;
  agents: Record<string, AgentState>;
  wallets: Record<string, Wallet>;
  events: WorldEvent[];
  processedPaymentTxHashes: string[];
  telemetry?: {
    aiApi?: {
      total: number;
      success: number;
      failed: number;
      lastError?: string;
      lastOkAt?: string;
      lastFailAt?: string;
    };
  };
  economy: {
    marketPricesMon: Record<string, number>;
    attackPenaltyMon: number;
    tradeReputationReward: number;
    aidReputationReward: number;
    governor: {
      lastEventIndex: number;
      lastRunAt: string;
    };
  };
  governance: {
    activePolicy: VotePolicy;
    votes: Record<VotePolicy, number>;
  };
}

export interface EntryRequest {
  agentId: string;
  walletAddress: string;
  paymentTxHash?: string;
}

export interface ActionRequest {
  agentId: string;
  action: ActionType;
  target?: LocationId;
  targetAgentId?: string;
  itemGive?: string;
  qtyGive?: number;
  itemTake?: string;
  qtyTake?: number;
  votePolicy?: VotePolicy;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const LOCATIONS: LocationId[] = ["town", "forest", "cavern"];
const ACTIONS: ActionType[] = ["move", "gather", "rest", "trade", "attack", "vote", "claim", "sell", "aid"];
const POLICIES: VotePolicy[] = ["neutral", "cooperative", "aggressive"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function fail(message: string): never {
  throw new ValidationError(message);
}

export function parseEntryRequest(input: unknown): EntryRequest {
  if (!isObject(input)) fail("entry payload must be an object");

  const agentId = input.agentId;
  const walletAddress = input.walletAddress;
  const paymentTxHash = input.paymentTxHash;

  if (typeof agentId !== "string" || agentId.length < 1 || agentId.length > 64 || !ID_PATTERN.test(agentId)) {
    fail("agentId must be 1-64 chars matching [a-zA-Z0-9_-]");
  }

  if (typeof walletAddress !== "string" || walletAddress.length < 1 || walletAddress.length > 128) {
    fail("walletAddress must be 1-128 chars");
  }

  if (paymentTxHash !== undefined) {
    if (typeof paymentTxHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(paymentTxHash)) {
      fail("paymentTxHash must be a 0x-prefixed 32-byte hash");
    }
  }

  return { agentId, walletAddress, paymentTxHash };
}

export function parseActionRequest(input: unknown): ActionRequest {
  if (!isObject(input)) fail("action payload must be an object");

  const agentId = input.agentId;
  const action = input.action;
  const target = input.target;
  const targetAgentId = input.targetAgentId;
  const itemGive = input.itemGive;
  const qtyGive = input.qtyGive;
  const itemTake = input.itemTake;
  const qtyTake = input.qtyTake;
  const votePolicy = input.votePolicy;

  if (typeof agentId !== "string" || agentId.length < 1 || agentId.length > 64 || !ID_PATTERN.test(agentId)) {
    fail("agentId must be 1-64 chars matching [a-zA-Z0-9_-]");
  }

  if (typeof action !== "string" || !ACTIONS.includes(action as ActionType)) {
    fail("action must be one of: move, gather, rest, trade, attack, vote, claim, sell, aid");
  }
  const safeAction = action as ActionType;

  if (safeAction === "move") {
    if (typeof target !== "string" || !LOCATIONS.includes(target as LocationId)) {
      fail("target is required for move and must be one of: town, forest, cavern");
    }
    return { agentId, action: safeAction, target: target as LocationId };
  }

  if (safeAction === "trade") {
    if (typeof targetAgentId !== "string" || targetAgentId.length < 1) {
      fail("targetAgentId is required for trade");
    }
    if (typeof itemGive !== "string" || itemGive.length < 1) fail("itemGive is required for trade");
    if (typeof itemTake !== "string" || itemTake.length < 1) fail("itemTake is required for trade");
    if (typeof qtyGive !== "number" || !Number.isInteger(qtyGive) || qtyGive <= 0) {
      fail("qtyGive must be a positive integer for trade");
    }
    if (typeof qtyTake !== "number" || !Number.isInteger(qtyTake) || qtyTake <= 0) {
      fail("qtyTake must be a positive integer for trade");
    }
    return { agentId, action: safeAction, targetAgentId, itemGive, qtyGive, itemTake, qtyTake };
  }

  if (safeAction === "attack") {
    if (typeof targetAgentId !== "string" || targetAgentId.length < 1) {
      fail("targetAgentId is required for attack");
    }
    return { agentId, action: safeAction, targetAgentId };
  }

  if (safeAction === "vote") {
    if (typeof votePolicy !== "string" || !POLICIES.includes(votePolicy as VotePolicy)) {
      fail("votePolicy must be one of: neutral, cooperative, aggressive");
    }
    return { agentId, action: safeAction, votePolicy: votePolicy as VotePolicy };
  }

  if (safeAction === "sell") {
    // `sell` uses itemGive/qtyGive to indicate which item is sold to the world market.
    if (typeof itemGive !== "string" || itemGive.length < 1) fail("itemGive is required for sell");
    if (typeof qtyGive !== "number" || !Number.isInteger(qtyGive) || qtyGive <= 0) {
      fail("qtyGive must be a positive integer for sell");
    }
    return { agentId, action: safeAction, itemGive, qtyGive };
  }

  if (safeAction === "aid") {
    if (typeof targetAgentId !== "string" || targetAgentId.length < 1) {
      fail("targetAgentId is required for aid");
    }
    // Optional: itemGive/qtyGive indicate which item is given to the target.
    if (itemGive !== undefined && (typeof itemGive !== "string" || itemGive.length < 1)) {
      fail("itemGive must be a non-empty string for aid");
    }
    if (qtyGive !== undefined && (typeof qtyGive !== "number" || !Number.isInteger(qtyGive) || qtyGive <= 0)) {
      fail("qtyGive must be a positive integer for aid");
    }
    return { agentId, action: safeAction, targetAgentId, itemGive, qtyGive };
  }

  if (target !== undefined) {
    if (typeof target !== "string" || !LOCATIONS.includes(target as LocationId)) {
      fail("target must be one of: town, forest, cavern");
    }
    return { agentId, action: safeAction, target: target as LocationId };
  }

  return { agentId, action: safeAction };
}

export function parseWorldState(input: unknown): WorldState {
  if (!isObject(input)) fail("world state must be an object");

  const tick = input.tick;
  const agents = input.agents;
  const wallets = input.wallets;
  const events = input.events;
  const processedPaymentTxHashes = input.processedPaymentTxHashes;
  const telemetry = input.telemetry;
  const economy = input.economy;
  const governance = input.governance;

  if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 0) {
    fail("world.tick must be a non-negative integer");
  }

  if (!isObject(agents)) fail("world.agents must be an object");
  if (!isObject(wallets)) fail("world.wallets must be an object");
  if (!Array.isArray(events)) fail("world.events must be an array");
  if (processedPaymentTxHashes !== undefined && !Array.isArray(processedPaymentTxHashes)) {
    fail("world.processedPaymentTxHashes must be an array");
  }
  if (telemetry !== undefined && !isObject(telemetry)) {
    fail("world.telemetry must be an object");
  }
  if (economy !== undefined && !isObject(economy)) {
    fail("world.economy must be an object");
  }
  if (governance !== undefined && !isObject(governance)) {
    fail("world.governance must be an object");
  }

  const typedWallets: Record<string, Wallet> = {};
  for (const [key, value] of Object.entries(wallets)) {
    if (!isObject(value)) fail(`wallet ${key} must be an object`);
    if (typeof value.address !== "string" || value.address.length < 1) fail(`wallet ${key}.address invalid`);
    if (typeof value.monBalance !== "number" || value.monBalance < 0) fail(`wallet ${key}.monBalance invalid`);
    typedWallets[key] = { address: value.address, monBalance: value.monBalance };
  }

  const typedAgents: Record<string, AgentState> = {};
  for (const [key, value] of Object.entries(agents)) {
    if (!isObject(value)) fail(`agent ${key} must be an object`);
    if (typeof value.id !== "string" || value.id.length < 1) fail(`agent ${key}.id invalid`);
    if (typeof value.walletAddress !== "string" || value.walletAddress.length < 1) fail(`agent ${key}.walletAddress invalid`);
    if (typeof value.enteredAt !== "string" || !isIsoDate(value.enteredAt)) fail(`agent ${key}.enteredAt invalid`);
    if (typeof value.location !== "string" || !LOCATIONS.includes(value.location as LocationId)) fail(`agent ${key}.location invalid`);
    if (typeof value.energy !== "number" || !Number.isInteger(value.energy) || value.energy < 0 || value.energy > 10) {
      fail(`agent ${key}.energy invalid`);
    }
    if (!isObject(value.inventory)) fail(`agent ${key}.inventory invalid`);
    if (typeof value.reputation !== "number" || !Number.isInteger(value.reputation) || value.reputation < 0) {
      fail(`agent ${key}.reputation invalid`);
    }

    const typedInventory: Record<string, number> = {};
    for (const [item, qty] of Object.entries(value.inventory)) {
      if (typeof item !== "string" || item.length < 1) fail(`agent ${key}.inventory key invalid`);
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0) fail(`agent ${key}.inventory qty invalid`);
      typedInventory[item] = qty;
    }

    typedAgents[key] = {
      id: value.id,
      walletAddress: value.walletAddress,
      enteredAt: value.enteredAt,
      location: value.location as LocationId,
      energy: value.energy,
      inventory: typedInventory,
      reputation: value.reputation
    };
  }

  const typedEvents: WorldEvent[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!isObject(event)) fail(`event ${i} must be an object`);
    if (typeof event.id !== "string" || event.id.length < 1) fail(`event ${i}.id invalid`);
    if (typeof event.at !== "string" || !isIsoDate(event.at)) fail(`event ${i}.at invalid`);
    if (typeof event.agentId !== "string" || event.agentId.length < 1) fail(`event ${i}.agentId invalid`);
    if (typeof event.type !== "string" || event.type.length < 1) fail(`event ${i}.type invalid`);
    if (typeof event.message !== "string" || event.message.length < 1) fail(`event ${i}.message invalid`);
    typedEvents.push({
      id: event.id,
      at: event.at,
      agentId: event.agentId,
      type: event.type,
      message: event.message
    });
  }

  const typedProcessedPaymentTxHashes: string[] = [];
  if (Array.isArray(processedPaymentTxHashes)) {
    for (let i = 0; i < processedPaymentTxHashes.length; i += 1) {
      const hash = processedPaymentTxHashes[i];
      if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
        fail(`processedPaymentTxHashes[${i}] invalid`);
      }
      typedProcessedPaymentTxHashes.push(hash.toLowerCase());
    }
  }

  const typedGovernance = {
    activePolicy: "neutral" as VotePolicy,
    votes: {
      neutral: 0,
      cooperative: 0,
      aggressive: 0
    } as Record<VotePolicy, number>
  };
  if (isObject(governance)) {
    const activePolicy = governance.activePolicy;
    const votes = governance.votes;

    if (typeof activePolicy === "string" && POLICIES.includes(activePolicy as VotePolicy)) {
      typedGovernance.activePolicy = activePolicy as VotePolicy;
    }
    if (isObject(votes)) {
      for (const policy of POLICIES) {
        const value = votes[policy];
        if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
          typedGovernance.votes[policy] = value;
        }
      }
    }
  }

  const typedTelemetry: WorldState["telemetry"] = {};
  if (isObject(telemetry)) {
    const aiApi = telemetry.aiApi;
    if (isObject(aiApi)) {
      const total = aiApi.total;
      const success = aiApi.success;
      const failed = aiApi.failed;
      const lastError = aiApi.lastError;
      const lastOkAt = aiApi.lastOkAt;
      const lastFailAt = aiApi.lastFailAt;
      typedTelemetry.aiApi = {
        total: typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : 0,
        success: typeof success === "number" && Number.isInteger(success) && success >= 0 ? success : 0,
        failed: typeof failed === "number" && Number.isInteger(failed) && failed >= 0 ? failed : 0,
        lastError: typeof lastError === "string" && lastError.trim().length > 0 ? lastError.slice(0, 240) : undefined,
        lastOkAt: typeof lastOkAt === "string" && isIsoDate(lastOkAt) ? lastOkAt : undefined,
        lastFailAt: typeof lastFailAt === "string" && isIsoDate(lastFailAt) ? lastFailAt : undefined
      };
    }
  }

  const typedEconomy: WorldState["economy"] = {
    marketPricesMon: {
      wood: 0.000001,
      herb: 0.0000015,
      ore: 0.000002,
      crystal: 0.000003,
      coin: 0.0000008
    },
    attackPenaltyMon: 0.000001,
    tradeReputationReward: 1,
    aidReputationReward: 2,
    governor: {
      lastEventIndex: 0,
      lastRunAt: new Date(0).toISOString()
    }
  };
  if (isObject(economy)) {
    const mp = economy.marketPricesMon;
    if (isObject(mp)) {
      for (const [k, v] of Object.entries(mp)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
          typedEconomy.marketPricesMon[String(k).toLowerCase()] = v;
        }
      }
    }
    const ap = economy.attackPenaltyMon;
    if (typeof ap === "number" && Number.isFinite(ap) && ap >= 0) typedEconomy.attackPenaltyMon = ap;
    const tr = economy.tradeReputationReward;
    if (typeof tr === "number" && Number.isFinite(tr) && tr >= 0) typedEconomy.tradeReputationReward = tr;
    const ar = economy.aidReputationReward;
    if (typeof ar === "number" && Number.isFinite(ar) && ar >= 0) typedEconomy.aidReputationReward = ar;
    const gov = economy.governor;
    if (isObject(gov)) {
      const lastEventIndex = gov.lastEventIndex;
      const lastRunAt = gov.lastRunAt;
      if (typeof lastEventIndex === "number" && Number.isInteger(lastEventIndex) && lastEventIndex >= 0) {
        typedEconomy.governor.lastEventIndex = lastEventIndex;
      }
      if (typeof lastRunAt === "string" && isIsoDate(lastRunAt)) {
        typedEconomy.governor.lastRunAt = lastRunAt;
      }
    }
  }

  return {
    tick,
    agents: typedAgents,
    wallets: typedWallets,
    events: typedEvents,
    processedPaymentTxHashes: typedProcessedPaymentTxHashes,
    telemetry: typedTelemetry,
    economy: typedEconomy,
    governance: typedGovernance
  };
}
