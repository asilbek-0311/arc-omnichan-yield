// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { RWAVault } from "./RWAVault.sol";

/**
 * @title ZapReceiver
 * @notice Receives bridged USDC from Circle Gateway CCTP and automatically deposits to RWAVault
 * @dev Implements graceful failure handling and recovery mechanisms
 *
 *      Flow:
 *      1. Circle Gateway mints USDC to this contract via CCTP
 *      2. User calls processBridgedDeposit(recipient, amount)
 *      3. Contract approves vault and deposits USDC
 *      4. yRWA shares transferred to recipient
 *
 *      Failure Handling:
 *      - If vault deposit fails, USDC stored in pendingDeposits[recipient]
 *      - User can call claimAndDeposit() to retry manually
 *      - Owner can call recoverFunds() for emergency recovery
 *
 *      Integration:
 *      - Circle Gateway depositForBurn(amount, domain, bytes32(address(this)), usdc)
 *      - ZapReceiver receives USDC automatically via CCTP
 *      - Frontend calls processBridgedDeposit() after attestation
 */
contract ZapReceiver is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Thrown when amount parameter is zero
    error AmountZero();

    /// @notice Thrown when recipient address is zero
    error RecipientZero();

    /// @notice Thrown when attempting to recover non-USDC token
    error OnlyUSDC();

    /// @notice Thrown when user has insufficient pending deposits
    /// @param requested Amount user tried to claim
    /// @param available Amount actually pending
    error InsufficientPendingDeposits(uint256 requested, uint256 available);

    /// @notice Thrown when contract has insufficient USDC balance
    /// @param requested Amount requested
    /// @param available USDC balance in contract
    error InsufficientBalance(uint256 requested, uint256 available);

    /// @notice Emitted when USDC is successfully deposited to vault
    /// @param recipient Address that received yRWA shares
    /// @param usdcAmount Amount of USDC deposited (6 decimals)
    /// @param sharesMinted Amount of yRWA minted (6 decimals)
    event ZapCompleted(address indexed recipient, uint256 usdcAmount, uint256 sharesMinted);

    /// @notice Emitted when vault deposit fails and funds stored for manual claim
    /// @param recipient Address that will claim pending deposit
    /// @param usdcAmount Amount of USDC that failed to deposit (6 decimals)
    /// @param reason Error message from vault
    event ZapFailed(address indexed recipient, uint256 usdcAmount, string reason);

    /// @notice Emitted when user manually claims and deposits pending funds
    /// @param user Address that claimed
    /// @param amount USDC amount deposited (6 decimals)
    /// @param shares yRWA shares received (6 decimals)
    event PendingDepositClaimed(address indexed user, uint256 amount, uint256 shares);

    /// @notice Emitted when owner recovers stuck funds (emergency only)
    /// @param token Token address recovered
    /// @param to Recipient address
    /// @param amount Amount recovered (token decimals)
    event FundsRecovered(address indexed token, address indexed to, uint256 amount);

    /// @notice RWAVault contract that receives USDC deposits
    RWAVault public immutable vault;

    /// @notice USDC token address (6 decimals)
    IERC20 public immutable usdc;

    /// @notice Pending USDC deposits waiting for manual claim
    /// @dev Maps user address => USDC amount (6 decimals)
    ///      Populated when vault deposit fails
    ///      Cleared when user calls claimAndDeposit()
    mapping(address => uint256) public pendingDeposits;

    /**
     * @notice Initializes the ZapReceiver contract
     * @param vault_ Address of the RWAVault contract
     * @param usdc_ Address of the USDC token (6 decimals)
     * @param owner_ Contract owner for emergency recovery functions
     * @dev Sets immutable vault and usdc references
     */
    constructor(address vault_, address usdc_, address owner_) Ownable(owner_) {
        require(vault_ != address(0), "VAULT_ADDRESS_ZERO");
        require(usdc_ != address(0), "USDC_ADDRESS_ZERO");
        vault = RWAVault(vault_);
        usdc = IERC20(usdc_);
    }

    /**
     * @notice Processes bridged USDC and deposits to vault (main entry point for Circle Gateway zaps)
     * @param recipient Address that will receive yRWA shares
     * @param amount Amount of USDC to process (6 decimals, must be <= contract's balance)
     * @return success True if vault deposit succeeded, false if stored in pendingDeposits
     * @dev Called by frontend after Circle Gateway CCTP attestation completes
     *
     *      Flow:
     *      1. Check contract has enough USDC (bridged via CCTP)
     *      2. Try to deposit USDC to vault
     *      3. If success: emit ZapCompleted, return true
     *      4. If fail: add to pendingDeposits, emit ZapFailed, return false
     *
     *      Requirements:
     *      - amount > 0
     *      - recipient != address(0)
     *      - contract USDC balance >= amount
     *
     * @custom:security Reentrancy protected
     */
    function processBridgedDeposit(address recipient, uint256 amount) external nonReentrant returns (bool success) {
        if (amount == 0) {
            revert AmountZero();
        }
        if (recipient == address(0)) {
            revert RecipientZero();
        }

        // Check contract has enough USDC (from Circle Gateway bridge)
        uint256 balance = usdc.balanceOf(address(this));
        if (amount > balance) {
            revert InsufficientBalance(amount, balance);
        }

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
     * @notice Receives USDC via transferFrom and deposits to vault (alternative to Circle Gateway)
     * @param recipient Address that will receive yRWA shares
     * @param amount Amount of USDC to transfer and deposit (6 decimals)
     * @return success True if vault deposit succeeded, false if stored in pendingDeposits
     * @dev Used when USDC is transferred directly (e.g., via LiFi) instead of Circle Gateway
     *      Caller must approve this contract for USDC amount first
     *
     *      Flow:
     *      1. Transfer USDC from caller to this contract
     *      2. Try to deposit USDC to vault
     *      3. If success: emit ZapCompleted, return true
     *      4. If fail: add to pendingDeposits, emit ZapFailed, return false
     *
     * @custom:security Reentrancy protected
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
     * @notice Internal vault deposit wrapper (enables try/catch error handling)
     * @param recipient Address to receive yRWA shares
     * @param amount USDC amount to deposit (6 decimals)
     * @return shares Amount of yRWA shares minted (6 decimals)
     * @dev MUST be called via this._depositToVault() for try/catch to work
     *      Cannot be called externally (requires msg.sender == address(this))
     *
     *      Why external?
     *      - Solidity try/catch only works on external calls
     *      - Called via processBridgedDeposit() or receiveAndDeposit()
     *      - Protected by msg.sender == address(this) check
     *
     *      Flow:
     *      1. Approve vault for USDC
     *      2. Call vault.deposit() - mints yRWA to this contract
     *      3. Transfer yRWA shares to recipient
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
     * @notice Manually claim and deposit pending USDC after failed auto-deposit
     * @dev Call this if your zap failed and USDC is stuck in pendingDeposits
     *
     *      When to use:
     *      - ZapFailed event was emitted with your address
     *      - pendingDeposits[yourAddress] > 0
     *      - Vault is now functional (was temporarily full, etc.)
     *
     *      Flow:
     *      1. Read pending balance
     *      2. Clear pending (prevent reentrancy)
     *      3. Deposit to vault
     *      4. Transfer yRWA shares to caller
     *
     *      Requirements:
     *      - caller must have pending deposits > 0
     *
     * @custom:security Reentrancy protected, checks-effects-interactions pattern
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
     * @notice Emergency recovery of stuck tokens (owner-only, use with caution)
     * @param token Token address to recover (can be USDC or yRWA)
     * @param to Recipient address
     * @param amount Amount to recover (token decimals)
     * @dev Only use for emergency recovery scenarios:
     *      - USDC stuck without pending deposits record
     *      - yRWA shares stuck from failed transfer
     *      - Other ERC20 tokens accidentally sent to contract
     *
     *      Warning:
     *      - Can bypass pending deposits mechanism
     *      - Should verify no users are waiting for claims
     *      - Document recovery in incident report
     *
     * @custom:security Owner-only, for emergency use
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
     * @notice Reject ETH transfers (contract only handles USDC)
     * @dev Circle Gateway uses USDC transfers, not ETH
     *      Prevents accidental ETH loss
     */
    receive() external payable {
        revert("NO_ETH_ACCEPTED");
    }
}
