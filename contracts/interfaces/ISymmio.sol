// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISymmio {
    function getCollateral() external view returns (address);

    function depositFor(address user, uint256 amount) external;
}
