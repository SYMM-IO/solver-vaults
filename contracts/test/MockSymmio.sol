// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockSymmio {
    address public collateral;
    mapping(address => uint256) public balances;

    constructor(address _collateral) {
        collateral = _collateral;
    }

    function getCollateral() external view returns (address) {
        return collateral;
    }

    function depositFor(uint256 amount, address partyB) external {
        balances[partyB] += amount;
    }

    function balanceOf(address partyB) external view returns (uint256) {
        return balances[partyB];
    }
}
