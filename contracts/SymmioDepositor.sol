// SPDX-License-Identifier: SYMM-Core-Business-Source-License-1.1
// This contract is licensed under the SYMM Core Business Source License 1.1
// Copyright (c) 2023 Symmetry Labs AG
// For more information, see https://docs.symm.io/legal-disclaimer/license
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./SymmioDepositorLpToken.sol";
import "./interfaces/ISymmio.sol";

contract SymmioDepositor is
    AccessControlEnumerableUpgradeable,
    PausableUpgradeable
{
    // Use SafeERC20 for safer token transfers
    using SafeERC20 for IERC20;

    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");
    bytes32 public constant BALANCER_ROLE = keccak256("BALANCER_ROLE");
    bytes32 public constant SETTER_ROLE = keccak256("SETTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    struct WithdrawRequest {
        address receiver;
        address sender;
        uint256 amount;
        uint256 minAmountOut;
        RequestStatus status;
        uint256 acceptedRatio;
    }

    enum RequestStatus {
        Pending,
        Ready,
        Done,
        Canceled
    }

    event Deposit(address indexed depositor, uint256 amount);
    event WithdrawRequestEvent(
        uint256 indexed requestId,
        address indexed sender,
        address indexed receiver,
        uint256 amount
    );
    event WithdrawRequestCanceled(uint256 indexed requestId);
    event WithdrawRequestAcceptedEvent(
        uint256 providedAmount,
        uint256[] acceptedRequestIds,
        uint256 paybackRatio
    );
    event WithdrawClaimedEvent(
        uint256 indexed requestId,
        address indexed receiver
    );
    event SymmioAddressUpdatedEvent(address indexed newSymmioAddress);
    event DepositLimitUpdatedEvent(uint256 value);

    ISymmio public symmio;
    address public collateralTokenAddress;
    address public lpTokenAddress;

    WithdrawRequest[] public withdrawRequests;
    uint256 public lockedBalance;
    uint256 public minimumPaybackRatio;
    uint256 public depositLimit;
    uint256 public currentDeposit;

    uint256 public collateralTokenDecimals;

    function __SymmioDepositor_init(
        address _symmioAddress,
        address _lpTokenAddress,
        uint256 _minimumPaybackRatio,
        uint256 _depositLimit
    ) internal onlyInitializing {
        __AccessControl_init();
        __Pausable_init();

        require(
            _minimumPaybackRatio <= 1e18,
            "SymmioSolverDepositor: Invalid ratio"
        );

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SETTER_ROLE, msg.sender);
        setSymmioAddress(_symmioAddress);
        setLpTokenAddress(_lpTokenAddress);
        setDepositLimit(_depositLimit);
        lockedBalance = 0;
        currentDeposit = 0;
        minimumPaybackRatio = _minimumPaybackRatio;
    }

    function setSymmioAddress(
        address _symmioAddress
    ) public onlyRole(SETTER_ROLE) {
        require(
            _symmioAddress != address(0),
            "SymmioSolverDepositor: Zero address"
        );
        symmio = ISymmio(_symmioAddress);
        address beforeCollateral = collateralTokenAddress;
        updateCollateral();
        require(
            beforeCollateral == collateralTokenAddress ||
            beforeCollateral == address(0),
            "SymmioSolverDepositor: Collateral can not be changed"
        );
        emit SymmioAddressUpdatedEvent(_symmioAddress);
    }

    function updateCollateral() internal {
        collateralTokenAddress = symmio.getCollateral();
        collateralTokenDecimals = IERC20Metadata(collateralTokenAddress)
            .decimals();
        require(
            collateralTokenDecimals <= 18,
            "SymmioSolverDepositor: Collateral decimals should be lower than or equal to 18"
        );
    }

    function setLpTokenAddress(
        address _symmioSolverDepositorTokenAddress
    ) internal {
        require(
            _symmioSolverDepositorTokenAddress != address(0),
            "SymmioSolverDepositor: Zero address"
        );
        lpTokenAddress = _symmioSolverDepositorTokenAddress;
        uint256 lpTokenDecimals = SymmioDepositorLpToken(
            _symmioSolverDepositorTokenAddress
        ).decimals();
        require(
            lpTokenDecimals == collateralTokenDecimals,
            "SymmioSolverDepositor: LP token decimals should be the same as collateral token"
        );
    }

    function setDepositLimit(
        uint256 _depositLimit
    ) public onlyRole(SETTER_ROLE) {
        depositLimit = _depositLimit;
        emit DepositLimitUpdatedEvent(_depositLimit);
    }

    function deposit(uint256 amount) external whenNotPaused {
        require(
            currentDeposit + amount <= depositLimit,
            "SymmioSolverDepositor: Deposit limit reached"
        );
        IERC20(collateralTokenAddress).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        SymmioDepositorLpToken(lpTokenAddress).mint(msg.sender, amount);
        currentDeposit += amount;
        emit Deposit(msg.sender, amount);
    }

    function requestWithdraw(
        uint256 amount,
        uint256 minAmountOut,
        address receiver
    ) external whenNotPaused {
        require(
            SymmioDepositorLpToken(lpTokenAddress).balanceOf(msg.sender) >=
            amount,
            "SymmioSolverDepositor: Insufficient token balance"
        );
        SymmioDepositorLpToken(lpTokenAddress).burnFrom(msg.sender, amount);
        require(
            receiver != address(0),
            "SymmioSolverDepositor: Zero address for receiver"
        );
        withdrawRequests.push(
            WithdrawRequest({
                sender: msg.sender,
                receiver: receiver,
                amount: amount,
                minAmountOut: minAmountOut,
                status: RequestStatus.Pending,
                acceptedRatio: 0
            })
        );
        emit WithdrawRequestEvent(
            withdrawRequests.length - 1,
            msg.sender,
            receiver,
            amount
        );
    }

    function cancelWithdrawRequest(uint256 id) external whenNotPaused {
        require(
            id < withdrawRequests.length,
            "SymmioSolverDepositor: Invalid request ID"
        );
        WithdrawRequest storage request = withdrawRequests[id];
        require(
            request.sender == msg.sender,
            "SymmioSolverDepositor: Only the sender of request can cancel it"
        );
        require(
            request.status == RequestStatus.Pending,
            "SymmioSolverDepositor: Invalid status"
        );
        request.status = RequestStatus.Canceled;
        SymmioDepositorLpToken(lpTokenAddress).mint(msg.sender, request.amount);
        emit WithdrawRequestCanceled(id);
    }

    function acceptWithdrawRequest(
        uint256 providedAmount,
        uint256[] memory _acceptedRequestIds,
        uint256 _paybackRatio
    ) external onlyRole(BALANCER_ROLE) whenNotPaused {
        IERC20(collateralTokenAddress).safeTransferFrom(
            msg.sender,
            address(this),
            providedAmount
        );
        require(
            _paybackRatio >= minimumPaybackRatio,
            "SymmioSolverDepositor: Payback ratio is too low"
        );
        require(
            _paybackRatio <= 1e18,
            "SymmioSolverDepositor: Payback ratio is too high"
        );
        uint256 totalRequiredBalance = lockedBalance;

        for (uint256 i = 0; i < _acceptedRequestIds.length; i++) {
            uint256 id = _acceptedRequestIds[i];
            require(
                id < withdrawRequests.length,
                "SymmioSolverDepositor: Invalid request ID"
            );
            require(
                withdrawRequests[id].status == RequestStatus.Pending,
                "SymmioSolverDepositor: Invalid accepted request"
            );
            uint256 amountOut = (withdrawRequests[id].amount * _paybackRatio) /
                        1e18;
            require(
                amountOut >= withdrawRequests[id].minAmountOut,
                "SymmioSolverDepositor: Payback ratio is too low for this request"
            );
            totalRequiredBalance += amountOut;
            currentDeposit -= withdrawRequests[id].amount;
            withdrawRequests[id].status = RequestStatus.Ready;
            withdrawRequests[id].acceptedRatio = _paybackRatio;
        }

        require(
            IERC20(collateralTokenAddress).balanceOf(address(this)) >=
            totalRequiredBalance,
            "SymmioSolverDepositor: Insufficient contract balance"
        );
        lockedBalance = totalRequiredBalance;
        emit WithdrawRequestAcceptedEvent(
            providedAmount,
            _acceptedRequestIds,
            _paybackRatio
        );
    }

    function claimForWithdrawRequest(uint256 requestId) external whenNotPaused {
        require(
            requestId < withdrawRequests.length,
            "SymmioSolverDepositor: Invalid request ID"
        );
        WithdrawRequest storage request = withdrawRequests[requestId];

        require(
            request.status == RequestStatus.Ready,
            "SymmioSolverDepositor: Request not ready for withdrawal"
        );

        request.status = RequestStatus.Done;
        uint256 amount = (request.amount * request.acceptedRatio) / 1e18;
        lockedBalance -= amount;
        IERC20(collateralTokenAddress).safeTransfer(request.receiver, amount);
        emit WithdrawClaimedEvent(requestId, request.receiver);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }
}
