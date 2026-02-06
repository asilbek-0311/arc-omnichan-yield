// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title YieldToken
 * @notice ERC20 token representing shares in the RWAVault.
 * @dev Minting and burning are restricted to the vault contract (owner).
 */
contract YieldToken is ERC20, Ownable {
    /**
     * @notice Initializes the yRWA token.
     * @param owner_ The vault contract that controls mint/burn.
     */
    constructor(address owner_) ERC20("Omni Yield RWA", "yRWA") Ownable(owner_) { }

    /**
     * @notice Returns token decimals (matches USDC).
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Mints yRWA to a recipient.
     * @dev Only callable by the vault (owner).
     * @param to Recipient address.
     * @param amount Amount to mint (6 decimals).
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burns yRWA from a holder.
     * @dev Only callable by the vault (owner).
     * @param from Holder address.
     * @param amount Amount to burn (6 decimals).
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
