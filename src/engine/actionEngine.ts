import { ActionRequest, VotePolicy, WorldState } from "../interfaces/types.js";
import { removeItems, addItems } from "../world/mechanics/inventory.js";
import { createEvent } from "../world/events/eventFactory.js";
import { gatherYield, canMove } from "../world/rules/rules.js";
import { MonSettlement } from "../economy/monSettlement.js";

const MON_REWARD_PER_UNIT = (() => {
  // Default claim reward is intentionally small so the economy doesn't inflate when entry fees are tiny.
  const raw = Number(process.env.MON_REWARD_PER_UNIT ?? "0.00001");
  if (!Number.isFinite(raw) || raw < 0) return 0.00001;
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

const FAUCET_FLOOR_MON = (() => {
  const raw = Number(process.env.FAUCET_FLOOR_MON ?? "0");
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
})();

const FAUCET_TOPUP_TO_MON = (() => {
  const raw = Number(process.env.FAUCET_TOPUP_TO_MON ?? "0");
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
})();

export class ActionEngine {
  private readonly nextAllowedActionAtByAgent = new Map<string, number>();
  private readonly lastOnchainMonTxAtByAgent = new Map<string, number>();
  private readonly tradePaymentMon: number;
  private readonly attackLootMon: number;
  private readonly minOnchainMonTxIntervalMs: number;
  private readonly marketSellEnabled: boolean;
  private readonly attackPenaltyMon: number;

  constructor(private readonly settlement?: MonSettlement) {
    const raw = Number(process.env.MON_TRADE_PAYMENT_MON ?? "0");
    this.tradePaymentMon = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const rawAttack = Number(process.env.MON_ATTACK_LOOT_MON ?? "0");
    this.attackLootMon = Number.isFinite(rawAttack) && rawAttack > 0 ? rawAttack : 0;
    const rawInterval = Number(process.env.MON_AGENT_TX_MIN_INTERVAL_MS ?? "30000");
    this.minOnchainMonTxIntervalMs = Number.isFinite(rawInterval) ? Math.max(0, Math.floor(rawInterval)) : 30000;
    this.marketSellEnabled = (process.env.MARKET_SELL_ENABLED ?? "true").toLowerCase() !== "false";
    const rawPenalty = Number(process.env.ATTACK_PENALTY_MON ?? "0.000001");
    this.attackPenaltyMon = Number.isFinite(rawPenalty) && rawPenalty > 0 ? rawPenalty : 0.000001;
  }

  private canSendOnchainMonTxNow(agentId: string): boolean {
    if (this.minOnchainMonTxIntervalMs <= 0) return true;
    const last = this.lastOnchainMonTxAtByAgent.get(agentId) ?? 0;
    return Date.now() - last >= this.minOnchainMonTxIntervalMs;
  }

  private markOnchainMonTx(agentId: string): void {
    this.lastOnchainMonTxAtByAgent.set(agentId, Date.now());
  }

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
      state.events.push(
        createEvent(state.events.length + 1, state.tick, agent.id, "rest", "Agent recovered energy")
      );
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
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
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "vote",
          `Voted for ${policy}; active policy is now ${state.governance.activePolicy}`
        )
      );
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
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
      // Keep enough precision for small-entry-fee demos (e.g., 0.0001 MON).
      const rewardMon = Number((rewardUnits * MON_REWARD_PER_UNIT * policyMultiplier).toFixed(6));
      let payoutTx: string | undefined;
      if (this.settlement) {
        const payout = this.settlement.payout(agent.walletAddress, rewardMon);
        if (!payout.ok) {
          return { ok: false, message: `On-chain payout failed: ${payout.reason ?? "unknown"}` };
        }
        payoutTx = payout.txHash;
      }
      wallet.monBalance += rewardMon;
      this.debitTreasuryCredits(state, rewardMon);
      agent.reputation -= rewardUnits * 2;
      state.tick += 1;
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "claim",
          `Claimed ${rewardMon} MON from reputation rewards${payoutTx ? ` (tx: ${payoutTx})` : ""}`
        )
      );
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
      this.bumpCooldown(state, agent.id);

      return {
        ok: true,
        message: `Claimed ${rewardMon} MON`,
        tick: state.tick,
        energy: agent.energy,
        location: agent.location
      };
    }

    if (req.action === "sell") {
      if (!this.marketSellEnabled) {
        return { ok: false, message: "Market selling is disabled" };
      }
      if (agent.location !== "town") {
        return { ok: false, message: "Sell is only available in town" };
      }
      if (!req.itemGive || !req.qtyGive) {
        return { ok: false, message: "Sell requires itemGive and qtyGive" };
      }
      if (agent.energy <= 0) {
        return { ok: false, message: "Not enough energy to sell, use rest" };
      }
      const item = req.itemGive;
      const qty = req.qtyGive;
      if (!Number.isInteger(qty) || qty <= 0) {
        return { ok: false, message: "qtyGive must be a positive integer" };
      }
      if ((agent.inventory[item] ?? 0) < qty) {
        return { ok: false, message: `Not enough ${item} to sell` };
      }

      const unitPrice = marketUnitPriceMon(state, item);
      if (unitPrice <= 0) {
        return { ok: false, message: `Item ${item} cannot be sold on the market` };
      }
      const policyMultiplier =
        state.governance.activePolicy === "cooperative" ? 1.1 : state.governance.activePolicy === "aggressive" ? 0.9 : 1;
      const payoutMon = Number((qty * unitPrice * policyMultiplier).toFixed(6));
      if (payoutMon <= 0) {
        return { ok: false, message: "Sell payout is too small (increase qty or adjust prices)" };
      }

      // Burn items first so state is consistent even if payout fails (we'll return error and not tick).
      if (!removeItems(agent.inventory, { [item]: qty })) {
        return { ok: false, message: `Not enough ${item} to sell` };
      }

      const wallet = state.wallets[agent.walletAddress] ?? { address: agent.walletAddress, monBalance: 0 };
      state.wallets[agent.walletAddress] = wallet;

      let payoutTx: string | undefined;
      if (this.settlement) {
        const payout = this.settlement.payout(agent.walletAddress, payoutMon);
        if (!payout.ok) {
          // Roll back inventory burn on failure.
          addItems(agent.inventory, { [item]: qty });
          return { ok: false, message: `On-chain market payout failed: ${payout.reason ?? "unknown"}` };
        }
        payoutTx = payout.txHash;
      }

      wallet.monBalance += payoutMon;
      this.debitTreasuryCredits(state, payoutMon);
      agent.energy -= 1;
      agent.reputation += 1;
      state.tick += 1;
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "sell",
          `Sold ${qty} ${item} at market for ${payoutMon} MON` + (payoutTx ? ` (tx: ${payoutTx})` : "")
        )
      );
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
      this.bumpCooldown(state, agent.id);
      return { ok: true, message: `Sold ${qty} ${item}`, tick: state.tick, energy: agent.energy, location: agent.location };
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
      state.events.push(createEvent(state.events.length + 1, state.tick, agent.id, "move", `Moved to ${to}`));
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
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
      const lootSummary = Object.entries(loot)
        .map(([k, v]) => `+${k}:${v}`)
        .join(" ");
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "gather",
          `Gathered resources at ${agent.location}${lootSummary ? ` (${lootSummary})` : ""}`
        )
      );
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
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

      // Optional on-chain MON transfer as part of trade, so agent-to-agent transactions are traceable.
      let tradeTx: string | undefined;
      if (this.settlement && this.tradePaymentMon > 0) {
        // Avoid spamming on-chain txs during fast loops; keep at most one per agent per interval.
        if (this.canSendOnchainMonTxNow(agent.id)) {
          const payout = this.settlement.transferFromAgent(agent.id, target.walletAddress, this.tradePaymentMon);
          if (!payout.ok) {
            return { ok: false, message: `On-chain trade payment failed: ${payout.reason ?? "unknown"}` };
          }
          tradeTx = payout.txHash;
          this.markOnchainMonTx(agent.id);
          // Mirror the on-chain transfer in the in-world credit balances.
          const actorWallet = state.wallets[agent.walletAddress] ?? { address: agent.walletAddress, monBalance: 0 };
          const targetWallet = state.wallets[target.walletAddress] ?? { address: target.walletAddress, monBalance: 0 };
          state.wallets[agent.walletAddress] = actorWallet;
          state.wallets[target.walletAddress] = targetWallet;
          actorWallet.monBalance = Math.max(0, actorWallet.monBalance - this.tradePaymentMon);
          targetWallet.monBalance += this.tradePaymentMon;
        }
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
      // Cooperation reward: helping/trading builds reputation. Cooperative policy amplifies it.
      const baseTradeRep = Math.max(0, Math.floor(state.economy?.tradeReputationReward ?? 1));
      const tradeRep = state.governance.activePolicy === "cooperative" ? Math.max(1, baseTradeRep + 1) : Math.max(1, baseTradeRep);
      agent.reputation += tradeRep;
      target.reputation += tradeRep;
      state.tick += 1;
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "trade",
          `Traded with ${target.id}: gave ${req.qtyGive} ${req.itemGive}, received ${req.qtyTake} ${req.itemTake}` +
            (tradeTx ? ` (mon tx: ${tradeTx})` : "")
        )
      );
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
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

      // Economic punishment: attacker pays a small MON fine to the world treasury.
      // This counter-balances the market payouts so the world doesn't just bleed MON over time.
      let penaltyTx: string | undefined;
      let penaltyTxFail: string | undefined;
      const treasury = (process.env.MON_TEST_TREASURY_ADDRESS ?? "world_treasury").trim() || "world_treasury";
      const basePenalty = Number(state.economy?.attackPenaltyMon ?? this.attackPenaltyMon);
      if (basePenalty > 0) {
        const policyMultiplier =
          state.governance.activePolicy === "aggressive" ? 1.5 : state.governance.activePolicy === "cooperative" ? 1.2 : 1;
        const desiredPenalty = Number((basePenalty * policyMultiplier).toFixed(6));
        const attackerWallet = state.wallets[agent.walletAddress] ?? { address: agent.walletAddress, monBalance: 0 };
        state.wallets[agent.walletAddress] = attackerWallet;
        const treasuryWallet = state.wallets[treasury] ?? { address: treasury, monBalance: 0 };
        state.wallets[treasury] = treasuryWallet;

        const effectivePenalty = Math.max(0, Math.min(attackerWallet.monBalance, desiredPenalty));
        if (effectivePenalty > 0) {
          attackerWallet.monBalance = Number((attackerWallet.monBalance - effectivePenalty).toFixed(6));
          treasuryWallet.monBalance = Number((treasuryWallet.monBalance + effectivePenalty).toFixed(6));

          if (this.settlement && treasury && this.canSendOnchainMonTxNow(agent.id)) {
            const payout = this.settlement.transferFromAgent(agent.id, treasury, effectivePenalty);
            if (payout.ok) {
              penaltyTx = payout.txHash;
              this.markOnchainMonTx(agent.id);
            } else {
              penaltyTxFail = payout.reason ?? "unknown";
            }
          }
        }
      }

      // Optional on-chain MON transfer from victim -> attacker, so PvP interactions are traceable.
      let lootTx: string | undefined;
      let lootTxFail: string | undefined;
      if (this.settlement && this.attackLootMon > 0) {
        // Rate-limit victim-signed transfers too, otherwise the same victim can get drained by gas.
        if (this.canSendOnchainMonTxNow(target.id)) {
          const payout = this.settlement.transferFromAgent(target.id, agent.walletAddress, this.attackLootMon);
          if (payout.ok) {
            lootTx = payout.txHash;
            this.markOnchainMonTx(target.id);
            const attackerWallet = state.wallets[agent.walletAddress] ?? { address: agent.walletAddress, monBalance: 0 };
            const victimWallet = state.wallets[target.walletAddress] ?? { address: target.walletAddress, monBalance: 0 };
            state.wallets[agent.walletAddress] = attackerWallet;
            state.wallets[target.walletAddress] = victimWallet;
            attackerWallet.monBalance += this.attackLootMon;
            victimWallet.monBalance = Math.max(0, victimWallet.monBalance - this.attackLootMon);
          } else {
            lootTxFail = payout.reason ?? "unknown";
          }
        }
      }

      state.tick += 1;
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "attack",
          `Attacked ${target.id} for ${damage} damage${stolen ? ` and stole 1 ${stolen}` : ""}` +
            (penaltyTx ? ` (penalty tx: ${penaltyTx})` : penaltyTxFail ? ` (penalty tx failed: ${penaltyTxFail})` : "") +
            (lootTx ? ` (loot tx: ${lootTx})` : lootTxFail ? ` (loot tx failed: ${lootTxFail})` : "")
        )
      );
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
      this.bumpCooldown(state, agent.id);

      return { ok: true, message: `Attacked ${target.id}`, tick: state.tick, energy: agent.energy, location: agent.location };
    }

    if (req.action === "aid") {
      const target = req.targetAgentId ? state.agents[req.targetAgentId] : undefined;
      if (!target) {
        return { ok: false, message: "Aid target agent not found" };
      }
      if (target.id === agent.id) {
        return { ok: false, message: "Cannot aid self" };
      }
      if (target.location !== agent.location) {
        return { ok: false, message: "Aid requires both agents at same location" };
      }
      if (agent.energy < 1) {
        return { ok: false, message: "Not enough energy to aid" };
      }

      let gave: { item: string; qty: number } | null = null;
      if (req.itemGive && req.qtyGive) {
        const qty = Math.floor(req.qtyGive);
        if (qty <= 0) {
          return { ok: false, message: "qtyGive must be a positive integer for aid" };
        }
        if (!removeItems(agent.inventory, { [req.itemGive]: qty })) {
          return { ok: false, message: `Not enough ${req.itemGive} to aid` };
        }
        addItems(target.inventory, { [req.itemGive]: qty });
        gave = { item: req.itemGive, qty };
      } else {
        // If no explicit item is provided, try to give 1 unit of something you have.
        const first = Object.entries(agent.inventory).find(([, qty]) => qty > 0);
        if (first) {
          const [item] = first;
          removeItems(agent.inventory, { [item]: 1 });
          addItems(target.inventory, { [item]: 1 });
          gave = { item, qty: 1 };
        } else {
          // Otherwise, "assist" by restoring a bit of energy (non-monetary help).
          target.energy = Math.min(10, target.energy + 1);
        }
      }

      agent.energy -= 1;
      const baseAidRep = Math.max(0, Math.floor(state.economy?.aidReputationReward ?? 2));
      const aidRep = state.governance.activePolicy === "cooperative" ? Math.max(1, baseAidRep + 1) : Math.max(1, baseAidRep);
      agent.reputation += aidRep;
      target.reputation += Math.max(1, Math.floor(aidRep / 2));

      state.tick += 1;
      state.events.push(
        createEvent(
          state.events.length + 1,
          state.tick,
          agent.id,
          "aid",
          gave
            ? `Aided ${target.id}: gave ${gave.qty} ${gave.item} (+rep ${aidRep})`
            : `Aided ${target.id}: restored energy (+rep ${aidRep})`
        )
      );
      this.applyPostActionEconomy(state, agent.id, agent.walletAddress);
      this.bumpCooldown(state, agent.id);
      return { ok: true, message: `Aided ${target.id}`, tick: state.tick, energy: agent.energy, location: agent.location };
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

  private applyPostActionEconomy(state: WorldState, agentId: string, walletAddress: string): void {
    this.applyPassiveMonDrip(state, walletAddress);
    this.applyFaucetFloor(state, agentId, walletAddress);
  }

  private applyFaucetFloor(state: WorldState, agentId: string, walletAddress: string): void {
    if (FAUCET_FLOOR_MON <= 0) {
      return;
    }
    const wallet = state.wallets[walletAddress] ?? { address: walletAddress, monBalance: 0 };
    if (wallet.monBalance >= FAUCET_FLOOR_MON) {
      state.wallets[walletAddress] = wallet;
      return;
    }

    const targetBalance = Math.max(FAUCET_FLOOR_MON, FAUCET_TOPUP_TO_MON);
    const before = wallet.monBalance;
    wallet.monBalance = Number(targetBalance.toFixed(6));
    state.wallets[walletAddress] = wallet;

    const toppedUpBy = Number((wallet.monBalance - before).toFixed(6));
    state.events.push(
      createEvent(
        state.events.length + 1,
        state.tick,
        agentId,
        "faucet",
        `Faucet topped wallet by ${toppedUpBy} MON to maintain minimum balance`
      )
    );
  }

  private debitTreasuryCredits(state: WorldState, amountMon: number): void {
    const addr = process.env.MON_TEST_TREASURY_ADDRESS;
    if (!addr || addr.trim().length === 0) {
      return;
    }
    const key = addr.trim();
    const wallet = state.wallets[key] ?? { address: key, monBalance: 0 };
    wallet.monBalance = Math.max(0, Number((wallet.monBalance - amountMon).toFixed(6)));
    state.wallets[key] = wallet;
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

function marketUnitPriceMon(state: WorldState, item: string): number {
  const key = String(item || "").toLowerCase();
  const fromState = state.economy?.marketPricesMon?.[key];
  if (typeof fromState === "number" && Number.isFinite(fromState) && fromState >= 0) return fromState;
  // Fallback: env defaults (kept for backwards compatibility).
  if (key === "wood") return Number(process.env.MARKET_PRICE_WOOD_MON ?? "0.000001");
  if (key === "herb") return Number(process.env.MARKET_PRICE_HERB_MON ?? "0.0000015");
  if (key === "ore") return Number(process.env.MARKET_PRICE_ORE_MON ?? "0.000002");
  if (key === "crystal") return Number(process.env.MARKET_PRICE_CRYSTAL_MON ?? "0.000003");
  if (key === "coin") return Number(process.env.MARKET_PRICE_COIN_MON ?? "0.0000008");
  return 0;
}
