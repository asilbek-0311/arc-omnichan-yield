// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { YieldToken } from "./YieldToken.sol";

/**
 * @title RWAVault
 * @notice USDC-based vault that mints yRWA shares and tracks off-chain RWA value.
 * @dev Share price is in 1e18 precision (WAD) for accurate calculations.
 *      yRWA has 6 decimals to match USDC.
 *
 *      Fee Structure:
 *      - Yield deposits: 20% (2000 BPS) goes to treasury, 80% increases share price
 *
 *      Share Price Formula:
 *      - sharePrice = (totalAssets * 1e18) / totalSupply
 *      - totalAssets = USDC balance + claimedRWAValue
 *
 *      Important:
 *      - Only USDC balance is liquid/withdrawable
 *      - claimedRWAValue is off-chain tracking only
 *      - Withdrawals fail if vault USDC < requested amount
 */
contract RWAVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Thrown when amount parameter is zero
    error AmountZero();
    /// @notice Thrown when vault USDC balance is insufficient for withdrawal
    /// @param requested Amount of USDC requested
    /// @param available Amount of USDC available in vault
    error InsufficientUSDC(uint256 requested, uint256 available);
    /// @notice Thrown when treasury address is zero
    error InvalidTreasury();

    /// @notice Emitted when a user deposits USDC and receives yRWA shares
    /// @param user Address that deposited USDC
    /// @param usdcIn Amount of USDC deposited (6 decimals)
    /// @param sharesMinted Amount of yRWA minted (6 decimals)
    event Deposited(address indexed user, uint256 usdcIn, uint256 sharesMinted);

    /// @notice Emitted when a user burns yRWA shares and receives USDC
    /// @param user Address that withdrew
    /// @param sharesBurned Amount of yRWA burned (6 decimals)
    /// @param usdcOut Amount of USDC withdrawn (6 decimals)
    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 usdcOut);

    /// @notice Emitted when yield is deposited with fee distribution
    /// @param grossAmount Total yield deposited (6 decimals)
    /// @param fee Amount sent to treasury (20% of gross, 6 decimals)
    /// @param netAmount Amount kept in vault to increase share price (80% of gross, 6 decimals)
    event YieldDistributed(uint256 grossAmount, uint256 fee, uint256 netAmount);

    /// @notice Emitted when off-chain RWA value is updated by owner
    /// @param oldValue Previous RWA value (6 decimals)
    /// @param newValue New RWA value (6 decimals)
    event RWAValueUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Underlying USDC token (6 decimals)
    IERC20 public immutable usdc;

    /// @notice Yield-bearing share token (yRWA, 6 decimals)
    YieldToken public immutable yieldToken;

    /// @notice Off-chain RWA holdings value in USDC decimals (6 decimals)
    /// @dev This is NOT liquid - only tracked for share price calculation
    ///      Withdrawals are limited by actual USDC balance
    uint256 public totalRWAValue;

    /// @notice Treasury address that receives yield fees (20% of deposits)
    address public treasury;

    /// @notice Fee basis points (2000 = 20%)
    uint256 public constant FEE_BPS = 2000;

    /// @notice Basis points denominator (10000 = 100%)
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /**
     * @notice Initializes the vault and deploys yRWA token
     * @param usdc_ Address of the USDC token (6 decimals)
     * @param owner_ Vault admin that can update RWA value and withdraw for investment
     * @param treasury_ Treasury address that receives yield fees (20%)
     */
    constructor(address usdc_, address owner_, address treasury_) Ownable(owner_) {
        require(usdc_ != address(0), "USDC_ADDRESS_ZERO");
        if (treasury_ == address(0)) {
            revert InvalidTreasury();
        }
        usdc = IERC20(usdc_);
        yieldToken = new YieldToken(address(this));
        treasury = treasury_;
    }

    /**
     * @notice Returns USDC balance held by the vault (liquid assets only)
     * @return USDC balance in 6 decimals
     * @dev This represents the maximum amount available for withdrawals
     */
    function totalUSDC() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Returns total assets under management (liquid + off-chain)
     * @return Total assets = USDC balance + claimedRWAValue (6 decimals)
     * @dev Used in share price calculation
     *      Only USDC portion is withdrawable
     */
    function totalAssets() public view returns (uint256) {
        return totalUSDC() + totalRWAValue;
    }

    /**
     * @notice Returns the current share price in WAD format (1e18 precision)
     * @return Share price: (totalAssets * 1e18) / totalSupply
     * @dev If no shares exist, returns 1e18 (1.0 price)
     *      Formula: sharePrice = (totalAssets * 1e18) / totalSupply
     *      Example: 1.05 USDC per yRWA = 1050000000000000000 (WAD)
     *      Use formatSharePrice() helper for display
     */
    function sharePrice() public view returns (uint256) {
        uint256 supply = yieldToken.totalSupply();
        if (supply == 0) {
            return 1e18;
        }
        return (totalAssets() * 1e18) / supply;
    }

    /**
     * @notice Deposits USDC and mints yRWA shares based on current share price
     * @param amount Amount of USDC to deposit (6 decimals)
     * @dev Caller must approve vault for USDC amount first
     *      Shares minted = (amount * 1e18) / sharePrice()
     *      Initial deposits mint 1:1 (sharePrice = 1.0)
     * @custom:security Reentrancy protected
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert AmountZero();
        }
        uint256 shares = (amount * 1e18) / sharePrice();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        yieldToken.mint(msg.sender, shares);
        emit Deposited(msg.sender, amount, shares);
    }

    /**
     * @notice Burns yRWA shares and returns USDC based on current share price
     * @param shares Amount of yRWA to burn (6 decimals)
     * @dev USDC returned = (shares * sharePrice()) / 1e18
     *      Reverts if vault USDC balance < amountOut
     *      Check totalUSDC() or maxWithdrawable() before calling
     * @custom:security Reentrancy protected
     */
    function withdraw(uint256 shares) external nonReentrant {
        if (shares == 0) {
            revert AmountZero();
        }
        uint256 amountOut = (shares * sharePrice()) / 1e18;
        uint256 available = totalUSDC();
        if (amountOut > available) {
            revert InsufficientUSDC(amountOut, available);
        }
        yieldToken.burn(msg.sender, shares);
        usdc.safeTransfer(msg.sender, amountOut);
        emit Withdrawn(msg.sender, shares, amountOut);
    }

    /**
     * @notice Withdraws USDC from vault to treasury for RWA investment
     * @param amount USDC amount to withdraw (6 decimals)
     * @dev Only callable by owner
     *      Reverts if amount > totalUSDC()
     *      Does NOT affect totalRWAValue - must be updated separately via updateRWAValue()
     * @custom:security Reentrancy protected, owner-only
     */
    function withdrawForInvestment(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) {
            revert AmountZero();
        }
        uint256 available = totalUSDC();
        if (amount > available) {
            revert InsufficientUSDC(amount, available);
        }
        usdc.safeTransfer(treasury, amount);
    }

    /**
     * @notice Deposits yield with fee distribution (20% treasury, 80% vault)
     * @param amount Gross USDC yield amount (6 decimals)
     * @dev Caller must approve vault for USDC amount first
     *      Fee: 20% (2000 BPS) → treasury
     *      Remaining: 80% → vault (increases share price for all holders)
     *      Formula: sharePrice increases as totalAssets increases
     * @custom:security Reentrancy protected
     */
    function depositYield(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert AmountZero();
        }
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        if (fee > 0) {
            usdc.safeTransfer(treasury, fee);
        }
        uint256 netAmount = amount - fee;
        emit YieldDistributed(amount, fee, netAmount);
    }

    /**
     * @notice Updates off-chain RWA value used in share price calculation
     * @param newValue New RWA value in USDC decimals (6 decimals)
     * @dev Only callable by owner
     *      This is off-chain tracking only - NOT liquid/withdrawable
     *      Affects sharePrice: sharePrice = (totalUSDC + totalRWAValue) * 1e18 / supply
     *      Use after withdrawForInvestment() to track RWA purchases
     * @custom:security Owner-only
     */
    function updateRWAValue(uint256 newValue) external onlyOwner {
        uint256 oldValue = totalRWAValue;
        totalRWAValue = newValue;
        emit RWAValueUpdated(oldValue, newValue);
    }
}
