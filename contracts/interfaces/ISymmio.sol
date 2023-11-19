// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISymmio {
    function getCollateral() external view returns (address);

    function depositFor(uint256 amount, address user) external;
}
