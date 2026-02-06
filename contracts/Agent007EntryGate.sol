// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Agent007EntryGate
/// @notice Receives entry payments, forwards funds to treasury, and emits verifiable entry events.
contract Agent007EntryGate {
    error ZeroAddressTreasury();
    error ZeroEntryFee();
    error InsufficientEntryFee(uint256 sent, uint256 required);
    error TreasuryTransferFailed();

    address public immutable treasury;
    uint256 public immutable entryFeeWei;

    event EntryPaid(address indexed payer, string indexed agentId, uint256 amountWei, address indexed treasury);

    constructor(address treasury_, uint256 entryFeeWei_) {
        if (treasury_ == address(0)) revert ZeroAddressTreasury();
        if (entryFeeWei_ == 0) revert ZeroEntryFee();
        treasury = treasury_;
        entryFeeWei = entryFeeWei_;
    }

    /// @notice Pay entry fee for a given agent id.
    /// @dev Callers can send more than the fee; all value is forwarded and emitted.
    function payEntry(string calldata agentId) external payable {
        if (msg.value < entryFeeWei) {
            revert InsufficientEntryFee(msg.value, entryFeeWei);
        }

        (bool ok, ) = treasury.call{value: msg.value}("");
        if (!ok) revert TreasuryTransferFailed();

        emit EntryPaid(msg.sender, agentId, msg.value, treasury);
    }
}
