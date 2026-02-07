// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { RWAVault } from "./RWAVault.sol";

/**
 * @title ZapReceiver
 * @notice Receives USDC from cross-chain bridges (LiFi, Circle Gateway) and automatically deposits to RWAVault
 * @dev Implements recovery mechanism if vault deposit fails
 */
contract ZapReceiver is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error AmountZero();
    error RecipientZero();
    error OnlyUSDC();
    error InsufficientPendingDeposits(uint256 requested, uint256 available);

    /// @notice Emitted when USDC is received and successfully deposited to vault
    event ZapCompleted(address indexed recipient, uint256 usdcAmount, uint256 sharesMinted);
    /// @notice Emitted when vault deposit fails and funds are stored for manual claim
    event ZapFailed(address indexed recipient, uint256 usdcAmount, string reason);
    /// @notice Emitted when user manually claims and deposits pending funds
    event PendingDepositClaimed(address indexed user, uint256 amount, uint256 shares);
    /// @notice Emitted when owner recovers stuck funds
    event FundsRecovered(address indexed token, address indexed to, uint256 amount);

    /// @notice RWA vault that will receive deposits
    RWAVault public immutable vault;
    /// @notice USDC token address
    IERC20 public immutable usdc;
    /// @notice Mapping of user => pending USDC amount (if vault deposit failed)
    mapping(address => uint256) public pendingDeposits;

    /**
     * @notice Initializes the ZapReceiver
     * @param vault_ Address of the RWAVault contract
     * @param usdc_ Address of the USDC token
     * @param owner_ Contract owner (for recovery functions)
     */
    constructor(address vault_, address usdc_, address owner_) Ownable(owner_) {
        require(vault_ != address(0), "VAULT_ADDRESS_ZERO");
        require(usdc_ != address(0), "USDC_ADDRESS_ZERO");
        vault = RWAVault(vault_);
        usdc = IERC20(usdc_);
    }

    /**
     * @notice Receives USDC and automatically deposits to vault
     * @dev Called by bridges/LiFi when USDC arrives. If vault deposit fails, funds are stored for manual claim
     * @param recipient The user who will receive yRWA shares
     * @param amount Amount of USDC received
     * @return success Whether the operation succeeded
     */
    function receiveAndDeposit(address recipient, uint256 amount) external nonReentrant returns (bool success) {
        if (amount == 0) {
            revert AmountZero();
        }
        if (recipient == address(0)) {
            revert RecipientZero();
        }

        // Transfer USDC from caller (bridge contract or user)
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Try to deposit to vault
        try this._depositToVault(recipient, amount) returns (uint256 shares) {
            emit ZapCompleted(recipient, amount, shares);
            return true;
        } catch Error(string memory reason) {
            // Vault deposit failed - store for manual claim
            pendingDeposits[recipient] += amount;
            emit ZapFailed(recipient, amount, reason);
            return false;
        } catch {
            // Unknown error - store for manual claim
            pendingDeposits[recipient] += amount;
            emit ZapFailed(recipient, amount, "Unknown error");
            return false;
        }
    }

    /**
     * @notice External wrapper for vault deposit (enables try/catch)
     * @dev MUST be called via this._depositToVault() for try/catch to work
     *      RWAVault.deposit() mints shares to msg.sender, so we receive them and transfer to recipient
     * @param recipient User receiving shares
     * @param amount USDC amount to deposit
     * @return shares Amount of yRWA shares minted
     */
    function _depositToVault(address recipient, uint256 amount) external returns (uint256 shares) {
        require(msg.sender == address(this), "INTERNAL_ONLY");

        // Approve vault to spend USDC
        usdc.approve(address(vault), amount);

        // Get yRWA balance before deposit
        IERC20 yRWA = IERC20(address(vault.yieldToken()));
        uint256 balanceBefore = yRWA.balanceOf(address(this));

        // Call vault deposit (will mint shares to this contract)
        vault.deposit(amount);

        // Calculate shares minted
        uint256 balanceAfter = yRWA.balanceOf(address(this));
        shares = balanceAfter - balanceBefore;

        // Transfer shares to actual recipient
        if (shares > 0) {
            yRWA.safeTransfer(recipient, shares);
        }

        return shares;
    }

    /**
     * @notice Allows users to manually claim and deposit their pending USDC
     * @dev Useful if vault had temporary issues preventing auto-deposit
     */
    function claimAndDeposit() external nonReentrant {
        uint256 amount = pendingDeposits[msg.sender];
        if (amount == 0) {
            revert InsufficientPendingDeposits(1, 0);
        }

        // Clear pending before external calls
        pendingDeposits[msg.sender] = 0;

        // Approve and deposit to vault
        usdc.approve(address(vault), amount);
        vault.deposit(amount);

        // Get shares and transfer to user
        uint256 shares = IERC20(address(vault.yieldToken())).balanceOf(address(this));
        if (shares > 0) {
            IERC20(address(vault.yieldToken())).safeTransfer(msg.sender, shares);
        }

        emit PendingDepositClaimed(msg.sender, amount, shares);
    }

    /**
     * @notice Owner function to recover stuck tokens (emergency use only)
     * @param token Token address to recover
     * @param to Recipient address
     * @param amount Amount to recover
     */
    function recoverFunds(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) {
            revert RecipientZero();
        }
        if (amount == 0) {
            revert AmountZero();
        }

        IERC20(token).safeTransfer(to, amount);
        emit FundsRecovered(token, to, amount);
    }

    /**
     * @notice Fallback function for Circle Gateway compatibility
     * @dev Circle Gateway may call this when bridging USDC
     */
    receive() external payable {
        revert("NO_ETH_ACCEPTED");
    }
}
