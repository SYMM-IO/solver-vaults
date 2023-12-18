# Symmio Solver Vaults

## Overview

This contract enables users to provide liquidity for a Hedger (solver) on the Symmio platform. When users deposit funds,
the contract issues vault tokens in a 1:1 ratio with the deposited amount. Users can stake these vault tokens in another
contract to earn returns. They also have the option to withdraw their funds anytime by returning their vault tokens.

The contract includes a 'minimumPaybackRatio' property, which specifies the minimum ratio of funds that users are
guaranteed to receive upon withdrawal. If a user requests a withdrawal, the Balancer has the capability to add extra
funds to the contract and approve the withdrawal request at a ratio exceeding the minimum required. Once the Balancer
accepts a withdrawal request, the approved amount is locked in the contract and cannot be transferred to Symmio
thereafter. This amount is reserved exclusively for users, who can then claim the amount that has been approved for
them.

Additionally, there's a deposit limit in place. This limit caps the total amount users can put into the contract. The
management of this limit is handled by the 'currentDeposit' variable.

## Contract Roles

- **Depositor Role:** Allowed to move funds to the symmio contract.
- **Balancer Role:** Can deposit funds into the contract to facilitate user withdrawals.
- **Setter Role:** Authorized to update contract settings.
- **Pauser and Unpauser Roles:** Manage the pausing and unpausing of the contract.

## Main Functions

- **deposit:** Allows users to deposit funds and receive vault tokens.
- **depositToSymmio:** Permits the Depositor role to deposit funds into Symmio on behalf of the solver.
- **requestWithdraw:** Users can request to withdraw funds, returning their vault tokens.
- **acceptWithdrawRequest:** The Balancer role can accept withdrawal requests, ensuring the payback ratio meets the
  minimum threshold.
- **claimForWithdrawRequest:** Users can claim their funds after their withdrawal request is accepted.

Use the following command for running tests:

```shell
npx hardhat test
```
