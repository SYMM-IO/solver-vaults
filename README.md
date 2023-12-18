# Symmio Solver Vaults

## Overview

This solution enables users to provide liquidity for a Hedger (solver) on the Symmio platform. Upon depositing funds,
the contract issues users vault tokens in a 1:1 ratio to their deposited amount. Users can then stake these vault tokens
in another contract to earn returns. Additionally, users have the flexibility to request the withdrawal of their funds
at any time by returning their vault tokens. The contract includes a 'minimumPaybackRatio' property, defining the least
ratio of funds users are guaranteed to receive upon withdrawal. When a user initiates a withdrawal request, the Balancer
can transfer additional funds into the contract and approve the withdrawal request at a ratio exceeding the minimum
stipulated ratio. After that user can claim their accepted amount.

## Contract Roles

- **Depositor Role:** Allowed to move funds to the symmio contract.
- **Balancer Role:** Can deposit funds into the contract to facilitate user withdrawals.
- **Setter Role:** Authorized to update contract settings.
- **Pauser and Unpauser Roles:** Manage the pausing and unpausing of the contract.

## Deposit and Withdrawal

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
