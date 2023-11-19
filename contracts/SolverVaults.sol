// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SolverVaultToken.sol";
import "./interfaces/ISymmio.sol";

contract SolverVault is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");
    bytes32 public constant BALANCER_ROLE = keccak256("BALANCER_ROLE");

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
        address indexed partyB,
        uint256 amount
    );
    event WithdrawRequestEvent(
        uint256 indexed requestId,
        address indexed receiver,
        uint256 amount
    );
    event WithdrawRequestAcceptedEvent(
        uint256[] acceptedRequestIds,
        uint256 paybackRatio
    );
    event WithdrawClaimedEvent(
        uint256 indexed requestId,
        address indexed receiver
    );
    event SymmioAddressUpdatedEvent(address indexed newSymmioAddress);
    event SymmioVaultTokenAddressUpdatedEvent(
        address indexed newSymmioVaultTokenAddress
    );

    IERC20 public collateralToken;
    ISymmio public symmio;
    SolverVaultToken public symmioVaultToken;

    WithdrawRequest[] public withdrawRequests;
    uint256 public lockedBalance;
    uint256 public minimumPaybackRatio;

    function initialize(
        address _symmioAddress,
        address _symmioVaultTokenAddress,
        uint256 _minimumPaybackRatio
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DEPOSITOR_ROLE, msg.sender);
        _grantRole(BALANCER_ROLE, msg.sender);
        setSymmioAddress(_symmioAddress);
        setSymmioVaultTokenAddress(_symmioVaultTokenAddress);
        lockedBalance = 0;
        minimumPaybackRatio = _minimumPaybackRatio;
    }

    function updateCollateral() public {
        address collateralAddress = symmio.getCollateral();
        collateralToken = IERC20(collateralAddress);
    }

    function setSymmioAddress(
        address _symmioAddress
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        symmio = ISymmio(_symmioAddress);
        updateCollateral();
        emit SymmioAddressUpdatedEvent(_symmioAddress);
    }

    function setSymmioVaultTokenAddress(
        address _symmioVaultTokenAddress
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        symmioVaultToken = SolverVaultToken(_symmioVaultTokenAddress);
        emit SymmioVaultTokenAddressUpdatedEvent(_symmioVaultTokenAddress);
    }

    function deposit(uint256 amount) public {
        require(
            collateralToken.transferFrom(msg.sender, address(this), amount),
            "SolverVault: Transfer failed"
        );
        symmioVaultToken.mint(msg.sender, amount);
        emit Deposit(msg.sender, amount);
    }

    function depositToSymmio(
        uint256 amount,
        address partyB
    ) public onlyRole(DEPOSITOR_ROLE) {
        uint256 contractBalance = collateralToken.balanceOf(address(this));
        require(
            contractBalance - lockedBalance >= amount,
            "SolverVault: Insufficient contract balance"
        );
        require(
            collateralToken.approve(address(symmio), amount),
            "SolverVault: Approve failed"
        );
        symmio.depositFor(amount, partyB);
        emit DepositToSymmio(msg.sender, partyB, amount);
    }

    function requestWithdraw(uint256 amount, address receiver) public {
        require(
            symmioVaultToken.balanceOf(msg.sender) >= amount,
            "SolverVault: Insufficient token balance"
        );
        symmioVaultToken.burnFrom(msg.sender, amount);

        withdrawRequests.push(
            WithdrawRequest({
                receiver: receiver,
                amount: amount,
                status: RequestStatus.Pending,
                acceptedRatio: 0
            })
        );
        emit WithdrawRequestEvent(
            withdrawRequests.length - 1,
            receiver,
            amount
        );
    }

    function acceptWithdrawRequest(
        uint256[] memory _acceptedRequestIds,
        uint256 _paybackRatio
    ) public onlyRole(BALANCER_ROLE) {
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
            collateralToken.balanceOf(address(this)) >= totalRequiredBalance,
            "SolverVault: Insufficient contract balance"
        );
        lockedBalance = totalRequiredBalance;
        emit WithdrawRequestAcceptedEvent(_acceptedRequestIds, _paybackRatio);
    }

    function claimForWithdrawRequest(uint256 requestId) public {
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
        require(
            collateralToken.transfer(request.receiver, amount),
            "SolverVault: Transfer failed"
        );
        emit WithdrawClaimedEvent(requestId, request.receiver);
    }
}
