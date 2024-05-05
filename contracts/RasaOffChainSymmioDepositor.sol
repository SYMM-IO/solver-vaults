// SPDX-License-Identifier: SYMM-Core-Business-Source-License-1.1
// This contract is licensed under the SYMM Core Business Source License 1.1
// Copyright (c) 2023 Symmetry Labs AG
// For more information, see https://docs.symm.io/legal-disclaimer/license
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./SymmioDepositor.sol";

contract RasaOffChainSymmioDepositor is Initializable, SymmioDepositor {
    // Use SafeERC20 for safer token transfers
    using SafeERC20 for IERC20;

    event BrokerUpdatedEvent(address indexed broker);
    event DepositToBroker(
        address indexed depositor,
        address indexed broker,
        uint256 amount
    );

    address public broker;

    function initialize(
        address _symmioAddress,
        address _lpTokenAddress,
        uint256 _minimumPaybackRatio,
        uint256 _depositLimit,
        address _broker
    ) public initializer {
        __SymmioDepositor_init(
            _symmioAddress,
            _lpTokenAddress,
            _minimumPaybackRatio,
            _depositLimit
        );
        setBroker(_broker);
    }

    function setBroker(address _broker) public onlyRole(SETTER_ROLE) {
        require(_broker != address(0), "RasaOffChainSymmioDepositor: Zero address");
        broker = _broker;
        emit BrokerUpdatedEvent(_broker);
    }

    function depositToBroker(
        uint256 amount
    ) external onlyRole(DEPOSITOR_ROLE) whenNotPaused {
        require(broker != address(0), "RasaOffChainSymmioDepositor: Zero address");
        uint256 contractBalance = IERC20(collateralTokenAddress).balanceOf(
            address(this)
        );
        require(
            contractBalance - lockedBalance >= amount,
            "RasaOffChainSymmioDepositor: Insufficient contract balance"
        );
        IERC20(collateralTokenAddress).safeTransfer(broker, amount);
        emit DepositToBroker(msg.sender, broker, amount);
    }
}
