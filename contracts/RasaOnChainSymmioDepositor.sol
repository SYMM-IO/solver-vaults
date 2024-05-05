// SPDX-License-Identifier: SYMM-Core-Business-Source-License-1.1
// This contract is licensed under the SYMM Core Business Source License 1.1
// Copyright (c) 2023 Symmetry Labs AG
// For more information, see https://docs.symm.io/legal-disclaimer/license
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISymmio.sol";
import "./SymmioDepositor.sol";

contract RasaOnChainSymmioDepositor is Initializable, SymmioDepositor {
    // Use SafeERC20 for safer token transfers
    using SafeERC20 for IERC20;

    event SolverUpdatedEvent(address indexed solver);
    event DepositToSymmio(
        address indexed depositor,
        address indexed solver,
        uint256 amount
    );

    address public solver;

    function initialize(
        address _symmioAddress,
        address _lpTokenAddress,
        uint256 _minimumPaybackRatio,
        uint256 _depositLimit,
        address _solver
    ) public initializer {
        __SymmioDepositor_init(
            _symmioAddress,
            _lpTokenAddress,
            _minimumPaybackRatio,
            _depositLimit
        );
        setSolver(_solver);
    }

    function setSolver(address _solver) public onlyRole(SETTER_ROLE) {
        require(_solver != address(0), "SymmioSolverDepositor: Zero address");
        solver = _solver;
        emit SolverUpdatedEvent(_solver);
    }

    function depositToSymmio(
        uint256 amount
    ) external onlyRole(DEPOSITOR_ROLE) whenNotPaused {
        uint256 contractBalance = IERC20(collateralTokenAddress).balanceOf(
            address(this)
        );
        require(
            contractBalance - lockedBalance >= amount,
            "RasaOnChainSymmioDepositor: Insufficient contract balance"
        );
        require(
            IERC20(collateralTokenAddress).approve(address(symmio), amount),
            "RasaOnChainSymmioDepositor: Approve failed"
        );
        symmio.depositFor(solver, amount);
        emit DepositToSymmio(msg.sender, solver, amount);
    }
}
