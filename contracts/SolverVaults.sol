// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./SolverVaultToken.sol";
import "./interfaces/ISymmio.sol";

contract SolverVault is
    Initializable,
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
        uint256 amount;
        RequestStatus status;
        uint256 acceptedRatio;
    }

    enum RequestStatus {
        Pending,
        Ready,
        Done
    }

    event Deposit(address indexed depositor, uint256 amount);
    event DepositToSymmio(
        address indexed depositor,
        address indexed solver,
        uint256 amount
    );
    event WithdrawRequestEvent(
        uint256 indexed requestId,
        address indexed receiver,
        uint256 amount
    );
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
    event SolverUpdatedEvent(address indexed solver);
    event DepositLimitUpdatedEvent(uint256 value);

    ISymmio public symmio;
    address public collateralTokenAddress;
    address public solverVaultTokenAddress;
    address public solver;

    WithdrawRequest[] public withdrawRequests;
    uint256 public lockedBalance;
    uint256 public minimumPaybackRatio;
    uint256 public depositLimit;
    uint256 public currentDeposit;

    uint256 public collateralTokenDecimals;
    uint256 public solverVaultTokenDecimals;

    function initialize(
        address _symmioAddress,
        address _symmioVaultTokenAddress,
        address _solver,
        uint256 _minimumPaybackRatio,
        uint256 _depositLimit
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DEPOSITOR_ROLE, msg.sender);
        _grantRole(BALANCER_ROLE, msg.sender);
        _grantRole(SETTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(UNPAUSER_ROLE, msg.sender);
        setSymmioAddress(_symmioAddress);
        setSymmioVaultTokenAddress(_symmioVaultTokenAddress);
        setDepositLimit(_depositLimit);
        setSolver(_solver);
        lockedBalance = 0;
        currentDeposit = 0;
        minimumPaybackRatio = _minimumPaybackRatio;
    }

    function setSymmioAddress(
        address _symmioAddress
    ) public onlyRole(SETTER_ROLE) {
        symmio = ISymmio(_symmioAddress);
        address beforeCollateral = collateralTokenAddress;
        updateCollateral();
        require(
            beforeCollateral == collateralTokenAddress ||
                beforeCollateral == address(0),
            "SolverVault: Collateral can not be changed"
        );
        emit SymmioAddressUpdatedEvent(_symmioAddress);
    }

    function setSolver(address _solver) public onlyRole(SETTER_ROLE) {
        solver = _solver;
        emit SolverUpdatedEvent(_solver);
    }

    function updateCollateral() internal {
        collateralTokenAddress = symmio.getCollateral();
        collateralTokenDecimals = IERC20Metadata(collateralTokenAddress)
            .decimals();
        require(
            collateralTokenDecimals <= 18,
            "SolverVault: Collateral decimals should be lower than 18"
        );
    }

    function setSymmioVaultTokenAddress(
        address _symmioVaultTokenAddress
    ) internal {
        solverVaultTokenAddress = _symmioVaultTokenAddress;
        solverVaultTokenDecimals = SolverVaultToken(_symmioVaultTokenAddress)
            .decimals();
        require(
            solverVaultTokenDecimals <= 18,
            "SolverVault: SolverVaultToken decimals should be lower than 18"
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
            "SolverVault: Deposit limit reached"
        );
        IERC20(collateralTokenAddress).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        uint256 amountInSolverVaultTokenDecimals = solverVaultTokenDecimals >=
            collateralTokenDecimals
            ? amount *
                (10 ** (solverVaultTokenDecimals - collateralTokenDecimals))
            : amount /
                (10 ** (collateralTokenDecimals - solverVaultTokenDecimals));

        SolverVaultToken(solverVaultTokenAddress).mint(
            msg.sender,
            amountInSolverVaultTokenDecimals
        );
        currentDeposit += amount;
        emit Deposit(msg.sender, amount);
    }

    function depositToSymmio(
        uint256 amount
    ) external onlyRole(DEPOSITOR_ROLE) whenNotPaused {
        uint256 contractBalance = IERC20(collateralTokenAddress).balanceOf(
            address(this)
        );
        require(
            contractBalance - lockedBalance >= amount,
            "SolverVault: Insufficient contract balance"
        );
        require(
            IERC20(collateralTokenAddress).approve(address(symmio), amount),
            "SolverVault: Approve failed"
        );
        symmio.depositFor(solver, amount);
        emit DepositToSymmio(msg.sender, solver, amount);
    }

    function requestWithdraw(
        uint256 amount,
        address receiver
    ) external whenNotPaused {
        require(
            SolverVaultToken(solverVaultTokenAddress).balanceOf(msg.sender) >=
                amount,
            "SolverVault: Insufficient token balance"
        );
        SolverVaultToken(solverVaultTokenAddress).burnFrom(msg.sender, amount);

        uint256 amountInCollateralDecimals = collateralTokenDecimals >=
            solverVaultTokenDecimals
            ? amount *
                (10 ** (collateralTokenDecimals - solverVaultTokenDecimals))
            : amount /
                (10 ** (solverVaultTokenDecimals - collateralTokenDecimals));

        currentDeposit -= amountInCollateralDecimals;

        withdrawRequests.push(
            WithdrawRequest({
                receiver: receiver,
                amount: amountInCollateralDecimals,
                status: RequestStatus.Pending,
                acceptedRatio: 0
            })
        );
        emit WithdrawRequestEvent(
            withdrawRequests.length - 1,
            receiver,
            amountInCollateralDecimals
        );
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
            "SolverVault: Payback ratio is too low"
        );
        uint256 totalRequiredBalance = lockedBalance;

        for (uint256 i = 0; i < _acceptedRequestIds.length; i++) {
            uint256 id = _acceptedRequestIds[i];
            require(
                id < withdrawRequests.length,
                "SolverVault: Invalid request ID"
            );
            require(
                withdrawRequests[id].status == RequestStatus.Pending,
                "SolverVault: Invalid accepted request"
            );
            totalRequiredBalance +=
                (withdrawRequests[id].amount * _paybackRatio) /
                1e18;
            withdrawRequests[id].status = RequestStatus.Ready;
            withdrawRequests[id].acceptedRatio = _paybackRatio;
        }

        require(
            IERC20(collateralTokenAddress).balanceOf(address(this)) >=
                totalRequiredBalance,
            "SolverVault: Insufficient contract balance"
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
            "SolverVault: Invalid request ID"
        );
        WithdrawRequest storage request = withdrawRequests[requestId];

        require(
            request.status == RequestStatus.Ready,
            "SolverVault: Request not ready for withdrawal"
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
