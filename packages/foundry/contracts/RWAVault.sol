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
 * @dev Share price is in 1e18 precision (WAD). yRWA has 6 decimals to match USDC.
 */
contract RWAVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error AmountZero();
    error InsufficientUSDC(uint256 requested, uint256 available);
    error InvalidTreasury();

    /// @notice Emitted when a user deposits USDC and receives yRWA.
    event Deposited(address indexed user, uint256 usdcIn, uint256 sharesMinted);
    /// @notice Emitted when a user burns yRWA and receives USDC.
    event Withdrawn(address indexed user, uint256 sharesBurned, uint256 usdcOut);
    /// @notice Emitted when yield is deposited and fees are taken.
    event YieldDistributed(uint256 grossAmount, uint256 fee, uint256 netAmount);
    /// @notice Emitted when off-chain RWA value is updated.
    event RWAValueUpdated(uint256 oldValue, uint256 newValue);

    /// @notice Underlying USDC token.
    IERC20 public immutable usdc;
    /// @notice Yield-bearing share token.
    YieldToken public immutable yieldToken;
    /// @notice Off-chain RWA holdings value in USDC decimals.
    uint256 public totalRWAValue;
    /// @notice Treasury address that receives yield fees.
    address public treasury;

    uint256 public constant FEE_BPS = 2000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /**
     * @notice Initializes the vault.
     * @param usdc_ Address of the USDC token.
     * @param owner_ Vault admin that can update RWA value.
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
     * @notice Returns USDC balance held by the vault.
     */
    function totalUSDC() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Returns total assets = USDC balance + off-chain RWA value.
     */
    function totalAssets() public view returns (uint256) {
        return totalUSDC() + totalRWAValue;
    }

    /**
     * @notice Returns the share price in WAD (1e18 precision).
     * @dev If no shares exist, returns 1e18.
     */
    function sharePrice() public view returns (uint256) {
        uint256 supply = yieldToken.totalSupply();
        if (supply == 0) {
            return 1e18;
        }
        return (totalAssets() * 1e18) / supply;
    }

    /**
     * @notice Deposits USDC and mints yRWA 1:1.
     * @param amount Amount of USDC to deposit (6 decimals).
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
     * @notice Burns yRWA and returns USDC based on current share price.
     * @param shares Amount of yRWA to redeem (6 decimals).
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
     * @notice Withdraws USDC from the vault to invest in RWA.
     * @dev Only callable by the vault owner.
     * @param amount USDC amount to withdraw.
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
     * @notice Deposits yield into the vault and routes a fee to the treasury.
     * @dev Caller must approve the vault for `amount`.
     * @param amount Gross USDC yield amount.
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
     * @notice Updates off-chain RWA value used in share price calculation.
     * @dev Only callable by the vault owner.
     * @param newValue New RWA value in USDC decimals.
     */
    function updateRWAValue(uint256 newValue) external onlyOwner {
        uint256 oldValue = totalRWAValue;
        totalRWAValue = newValue;
        emit RWAValueUpdated(oldValue, newValue);
    }
}
