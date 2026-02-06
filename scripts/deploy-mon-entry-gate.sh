#!/usr/bin/env bash
set -euo pipefail

if ! command -v forge >/dev/null 2>&1; then
  echo "forge is required (https://book.getfoundry.sh/getting-started/installation)" >&2
  exit 1
fi

if [ -z "${MON_TEST_RPC_URL:-}" ]; then
  echo "MON_TEST_RPC_URL is required" >&2
  exit 1
fi

if [ -z "${MON_TEST_DEPLOYER_PRIVATE_KEY:-}" ]; then
  echo "MON_TEST_DEPLOYER_PRIVATE_KEY is required" >&2
  exit 1
fi

if [ -z "${MON_TEST_TREASURY_ADDRESS:-}" ]; then
  echo "MON_TEST_TREASURY_ADDRESS is required" >&2
  exit 1
fi

if [ -z "${MON_TEST_ENTRY_FEE_WEI:-}" ]; then
  if [ -z "${MON_TEST_ENTRY_FEE_MON:-}" ]; then
    echo "Set MON_TEST_ENTRY_FEE_WEI or MON_TEST_ENTRY_FEE_MON" >&2
    exit 1
  fi
  if ! command -v cast >/dev/null 2>&1; then
    echo "cast is required to convert MON_TEST_ENTRY_FEE_MON to wei" >&2
    exit 1
  fi
  ENTRY_FEE_WEI="$(cast to-wei "${MON_TEST_ENTRY_FEE_MON}" ether)"
else
  ENTRY_FEE_WEI="${MON_TEST_ENTRY_FEE_WEI}"
fi

echo "Deploying Agent007EntryGate..."
echo "  treasury: ${MON_TEST_TREASURY_ADDRESS}"
echo "  entryFeeWei: ${ENTRY_FEE_WEI}"

forge create \
  contracts/Agent007EntryGate.sol:Agent007EntryGate \
  --rpc-url "${MON_TEST_RPC_URL}" \
  --private-key "${MON_TEST_DEPLOYER_PRIVATE_KEY}" \
  --constructor-args "${MON_TEST_TREASURY_ADDRESS}" "${ENTRY_FEE_WEI}" \
  --broadcast
