import assert from "node:assert/strict";
import { MonTestnetPaymentGateway } from "../../src/economy/monTestnetPaymentGateway.js";
import { EvmTransaction, EvmTransactionReceipt, MonTestnetRpcClient } from "../../src/economy/monTestnetRpcClient.js";
import { WorldState } from "../../src/interfaces/types.js";

class FakeRpcClient implements MonTestnetRpcClient {
  constructor(
    private readonly tx: EvmTransaction | null,
    private readonly receipt: EvmTransactionReceipt | null,
    private readonly blockNumber: bigint
  ) {}

  getTransactionByHash(_txHash: string): EvmTransaction | null {
    return this.tx;
  }

  getTransactionReceipt(_txHash: string): EvmTransactionReceipt | null {
    return this.receipt;
  }

  getBlockNumber(): bigint {
    return this.blockNumber;
  }
}

const goodState: WorldState = {
  tick: 100,
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

const txHash = "0x" + "a".repeat(64);
const okGateway = new MonTestnetPaymentGateway(
  new FakeRpcClient(
    {
      hash: txHash,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "0x1bc16d674ec80000",
      chainId: "0x279f"
    },
    {
      transactionHash: txHash,
      status: "0x1",
      blockNumber: "0x64",
      to: "0x2222222222222222222222222222222222222222"
    },
    110n
  ),
  {
    treasuryAddress: "0x2222222222222222222222222222222222222222",
    requiredConfirmations: 2,
    expectedChainIdHex: "0x279f",
    entryFeeMon: 2,
    decimals: 18
  }
);

const ok = okGateway.chargeEntryFee(goodState, {
  agentId: "a1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  paymentTxHash: txHash
});
assert.equal(ok.ok, true);
assert.equal(ok.txHash, txHash);

const replayState: WorldState = {
  ...goodState,
  processedPaymentTxHashes: [txHash]
};
const replay = okGateway.chargeEntryFee(replayState, {
  agentId: "a1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  paymentTxHash: txHash
});
assert.equal(replay.ok, false);

const pendingGateway = new MonTestnetPaymentGateway(
  new FakeRpcClient(
    {
      hash: txHash,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "0x1bc16d674ec80000"
    },
    null,
    110n
  ),
  {
    treasuryAddress: "0x2222222222222222222222222222222222222222",
    requiredConfirmations: 2,
    entryFeeMon: 2,
    decimals: 18
  }
);

const pending = pendingGateway.chargeEntryFee(goodState, {
  agentId: "a1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  paymentTxHash: txHash
});
assert.equal(pending.ok, false);
assert.equal(pending.reason, "transaction is pending confirmation");

console.log("mon testnet gateway checks passed");

const entryContractAddress = "0x3333333333333333333333333333333333333333";
const payEntrySelector = "0x42cccee4";
const selectorGateway = new MonTestnetPaymentGateway(
  new FakeRpcClient(
    {
      hash: txHash,
      from: "0x1111111111111111111111111111111111111111",
      to: entryContractAddress,
      value: "0x1bc16d674ec80000",
      input: "0x42cccee40000000000000000000000000000000000000000000000000000000000000020"
    },
    {
      transactionHash: txHash,
      status: "0x1",
      blockNumber: "0x64",
      to: entryContractAddress
    },
    110n
  ),
  {
    treasuryAddress: "0x2222222222222222222222222222222222222222",
    entryContractAddress,
    entryContractMethodSelector: payEntrySelector,
    requiredConfirmations: 2,
    entryFeeMon: 2,
    decimals: 18
  }
);

const contractOk = selectorGateway.chargeEntryFee(goodState, {
  agentId: "a1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  paymentTxHash: txHash
});
assert.equal(contractOk.ok, true);

const badSelectorGateway = new MonTestnetPaymentGateway(
  new FakeRpcClient(
    {
      hash: txHash,
      from: "0x1111111111111111111111111111111111111111",
      to: entryContractAddress,
      value: "0x1bc16d674ec80000",
      input: "0xdeadbeef00000000000000000000000000000000000000000000000000000000"
    },
    {
      transactionHash: txHash,
      status: "0x1",
      blockNumber: "0x64",
      to: entryContractAddress
    },
    110n
  ),
  {
    treasuryAddress: "0x2222222222222222222222222222222222222222",
    entryContractAddress,
    entryContractMethodSelector: payEntrySelector,
    requiredConfirmations: 2,
    entryFeeMon: 2,
    decimals: 18
  }
);
const badSelector = badSelectorGateway.chargeEntryFee(goodState, {
  agentId: "a1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  paymentTxHash: txHash
});
assert.equal(badSelector.ok, false);
