import { ActionRequest, VotePolicy, WorldState } from "../interfaces/types.js";
import { removeItems, addItems } from "../world/mechanics/inventory.js";
import { createEvent } from "../world/events/eventFactory.js";
import { gatherYield, canMove } from "../world/rules/rules.js";

const MON_REWARD_PER_UNIT = (() => {
  const raw = Number(process.env.MON_REWARD_PER_UNIT ?? "0.01");
  if (!Number.isFinite(raw) || raw < 0) return 0.01;
  return raw;
})();

const MIN_ACTION_COOLDOWN_MS = (() => {
  const raw = Number(process.env.ACTION_MIN_COOLDOWN_MS ?? "5000");
  if (!Number.isFinite(raw)) return 5000;
  return Math.max(1000, raw);
})();

const MAX_ACTION_COOLDOWN_MS = (() => {
  const raw = Number(process.env.ACTION_MAX_COOLDOWN_MS ?? "15000");
  if (!Number.isFinite(raw)) return 15000;
  return Math.max(MIN_ACTION_COOLDOWN_MS, raw);
})();

const PASSIVE_MON_DRIP_PER_ACTION = (() => {
  const raw = Number(process.env.PASSIVE_MON_DRIP_PER_ACTION ?? "0");
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
})();

export class ActionEngine {
  private readonly nextAllowedActionAtByAgent = new Map<string, number>();

  resolve(
    state: WorldState,
    req: ActionRequest
  ): { ok: boolean; message: string; tick?: number; energy?: number; location?: string } {
    const agent = state.agents[req.agentId];

    if (!agent) {
      return { ok: false, message: "Agent has not entered the world" };
    }

    const nowMs = Date.now();
    const nextAllowedAtMs = this.nextAllowedActionAtByAgent.get(agent.id) ?? 0;
    if (nowMs < nextAllowedAtMs) {
      const waitSec = Math.max(1, Math.ceil((nextAllowedAtMs - nowMs) / 1000));
      return { ok: false, message: `Agent is planning. Try again in ${waitSec}s` };
    }

    if (req.action === "rest") {
      agent.energy = Math.min(10, agent.energy + 3);
      state.tick += 1;
      this.applyPassiveMonDrip(state, agent.walletAddress);
      state.events.push(
        createEvent(state.events.length + 1, state.tick, agent.id, "rest", "Agent recovered energy")
      );
      this.bumpCooldown(state, agent.id);
      return { ok: true, message: "Rested successfully", tick: state.tick, energy: agent.energy, location: agent.location };
    }

    if (req.action === "vote") {
      const policy = req.votePolicy;
      if (!policy) {
        return { ok: false, message: "votePolicy is required for vote action" };
      }

      state.governance.votes[policy] += 1;
      state.governance.activePolicy = pickPolicy(state.governance.votes, state.governance.activePolicy);
      state.tick += 1;
      this.applyPassiveMonDrip(state, agent.walletAddress);
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "vote",
          `Voted for ${policy}; active policy is now ${state.governance.activePolicy}`
        )
      );
      this.bumpCooldown(state, agent.id);
      return {
        ok: true,
        message: `Vote accepted. Active policy: ${state.governance.activePolicy}`,
        tick: state.tick,
        energy: agent.energy,
        location: agent.location
      };
    }

    if (req.action === "claim") {
      const wallet = state.wallets[agent.walletAddress] ?? { address: agent.walletAddress, monBalance: 0 };
      state.wallets[agent.walletAddress] = wallet;

      const rewardUnits = Math.floor(agent.reputation / 2);
      if (rewardUnits <= 0) {
        return { ok: false, message: "Not enough reputation to claim rewards" };
      }

      const policyMultiplier = state.governance.activePolicy === "cooperative" ? 1.2 : state.governance.activePolicy === "aggressive" ? 0.8 : 1;
      const rewardMon = Number((rewardUnits * MON_REWARD_PER_UNIT * policyMultiplier).toFixed(4));
      wallet.monBalance += rewardMon;
      agent.reputation -= rewardUnits * 2;
      this.applyPassiveMonDrip(state, agent.walletAddress);
      state.tick += 1;
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "claim",
          `Claimed ${rewardMon} MON from reputation rewards`
        )
      );
      this.bumpCooldown(state, agent.id);

      return {
        ok: true,
        message: `Claimed ${rewardMon} MON`,
        tick: state.tick,
        energy: agent.energy,
        location: agent.location
      };
    }

    if (agent.energy <= 0) {
      return { ok: false, message: "Agent is too tired, use rest" };
    }

    if (req.action === "move") {
      if (!req.target) {
        return { ok: false, message: "Move action requires target location" };
      }

      const to = req.target;
      if (!canMove(agent.location, to)) {
        return { ok: false, message: `Cannot move from ${agent.location} to ${to}` };
      }

      agent.location = to;
      agent.energy -= 1;
      state.tick += 1;
      this.applyPassiveMonDrip(state, agent.walletAddress);
      state.events.push(createEvent(state.events.length + 1, state.tick, agent.id, "move", `Moved to ${to}`));
      this.bumpCooldown(state, agent.id);
      return { ok: true, message: `Moved to ${to}`, tick: state.tick, energy: agent.energy, location: agent.location };
    }

    if (req.action === "gather") {
      if (agent.energy < 2) {
        return { ok: false, message: "Not enough energy to gather, use rest" };
      }

      const loot = gatherYield(agent.location);
      if (state.governance.activePolicy === "cooperative") {
        for (const key of Object.keys(loot)) {
          loot[key] += 1;
        }
      }

      addItems(agent.inventory, loot);
      agent.energy -= 2;
      agent.reputation += 1;
      state.tick += 1;
      this.applyPassiveMonDrip(state, agent.walletAddress);
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "gather",
          `Gathered resources at ${agent.location}`
        )
      );
      this.bumpCooldown(state, agent.id);
      return { ok: true, message: `Gathered ${Object.keys(loot).join(", ")}`, tick: state.tick, energy: agent.energy, location: agent.location };
    }

    if (req.action === "trade") {
      const target = req.targetAgentId ? state.agents[req.targetAgentId] : undefined;
      if (!target) {
        return { ok: false, message: "Trade target agent not found" };
      }
      if (target.id === agent.id) {
        return { ok: false, message: "Cannot trade with self" };
      }
      if (target.location !== agent.location) {
        return { ok: false, message: "Trade requires both agents at same location" };
      }

      if (!req.itemGive || !req.itemTake || !req.qtyGive || !req.qtyTake) {
        return { ok: false, message: "Trade requires itemGive/itemTake and qtyGive/qtyTake" };
      }

      const actorGive = { [req.itemGive]: req.qtyGive };
      const targetGive = { [req.itemTake]: req.qtyTake };
      if (!removeItems(agent.inventory, actorGive)) {
        return { ok: false, message: `Not enough ${req.itemGive} to trade` };
      }
      if (!removeItems(target.inventory, targetGive)) {
        addItems(agent.inventory, actorGive);
        return { ok: false, message: `${target.id} has insufficient ${req.itemTake}` };
      }

      addItems(agent.inventory, targetGive);
      addItems(target.inventory, actorGive);
      agent.energy -= 1;
      agent.reputation += 1;
      target.reputation += 1;
      state.tick += 1;
      this.applyPassiveMonDrip(state, agent.walletAddress);
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "trade",
          `Traded with ${target.id}: gave ${req.qtyGive} ${req.itemGive}, received ${req.qtyTake} ${req.itemTake}`
        )
      );
      this.bumpCooldown(state, agent.id);
      return { ok: true, message: `Trade completed with ${target.id}`, tick: state.tick, energy: agent.energy, location: agent.location };
    }

    if (req.action === "attack") {
      const target = req.targetAgentId ? state.agents[req.targetAgentId] : undefined;
      if (!target) {
        return { ok: false, message: "Attack target agent not found" };
      }
      if (target.id === agent.id) {
        return { ok: false, message: "Cannot attack self" };
      }
      if (target.location !== agent.location) {
        return { ok: false, message: "Attack requires both agents at same location" };
      }
      if (agent.energy < 2) {
        return { ok: false, message: "Not enough energy to attack" };
      }

      const damage = state.governance.activePolicy === "aggressive" ? 4 : 2;
      target.energy = Math.max(0, target.energy - damage);
      agent.energy -= 2;
      agent.reputation = Math.max(0, agent.reputation - 1);

      const stolen = stealFirstItem(target.inventory);
      if (stolen) {
        addItems(agent.inventory, { [stolen]: 1 });
      }

      state.tick += 1;
      this.applyPassiveMonDrip(state, agent.walletAddress);
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "attack",
          `Attacked ${target.id} for ${damage} damage${stolen ? ` and stole 1 ${stolen}` : ""}`
        )
      );
      this.bumpCooldown(state, agent.id);

      return { ok: true, message: `Attacked ${target.id}`, tick: state.tick, energy: agent.energy, location: agent.location };
    }

    return { ok: false, message: "Unsupported action" };
  }

  private bumpCooldown(state: WorldState, agentId: string): void {
    const agent = state.agents[agentId];
    if (!agent) {
      return;
    }

    const wallet = state.wallets[agent.walletAddress];
    const monBalance = wallet?.monBalance ?? 0;
    const inventoryUnits = Object.values(agent.inventory).reduce((sum, qty) => sum + qty, 0);

    const monDelayMs = Math.min(1, monBalance) * 7000;
    const inventoryDelayMs = Math.min(30, inventoryUnits) * 220;
    const reputationDelayMs = Math.min(10, Math.max(0, agent.reputation)) * 150;
    const energyDiscountMs = agent.energy <= 2 ? 1500 : 0;
    const cooldownMs = clamp(MIN_ACTION_COOLDOWN_MS + monDelayMs + inventoryDelayMs + reputationDelayMs - energyDiscountMs, MIN_ACTION_COOLDOWN_MS, MAX_ACTION_COOLDOWN_MS);

    this.nextAllowedActionAtByAgent.set(agentId, Date.now() + cooldownMs);
  }

  private applyPassiveMonDrip(state: WorldState, walletAddress: string): void {
    if (PASSIVE_MON_DRIP_PER_ACTION <= 0) {
      return;
    }
    const wallet = state.wallets[walletAddress] ?? { address: walletAddress, monBalance: 0 };
    wallet.monBalance = Number((wallet.monBalance + PASSIVE_MON_DRIP_PER_ACTION).toFixed(6));
    state.wallets[walletAddress] = wallet;
  }
}

function pickPolicy(votes: Record<VotePolicy, number>, current: VotePolicy): VotePolicy {
  const policies: VotePolicy[] = ["neutral", "cooperative", "aggressive"];
  let best: VotePolicy = current;
  for (const policy of policies) {
    if (votes[policy] > votes[best]) {
      best = policy;
    }
  }
  return best;
}

function stealFirstItem(inventory: Record<string, number>): string | null {
  for (const [item, qty] of Object.entries(inventory)) {
    if (qty > 0) {
      inventory[item] -= 1;
      if (inventory[item] <= 0) {
        delete inventory[item];
      }
      return item;
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
