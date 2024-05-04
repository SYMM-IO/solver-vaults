// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockSymmio {
    // Use SafeERC20 for safer token transfers
    using SafeERC20 for IERC20;

    address public collateral;
    mapping(address => uint256) public balances;

    constructor(address _collateral) {
        collateral = _collateral;
    }

    function getCollateral() external view returns (address) {
        return collateral;
    }

    function depositFor(address partyB, uint256 amount) external {
        IERC20(collateral).transferFrom(msg.sender, address(this), amount);
        balances[partyB] += amount;
    }

    function balanceOf(address partyB) external view returns (uint256) {
        return balances[partyB];
    }
}
