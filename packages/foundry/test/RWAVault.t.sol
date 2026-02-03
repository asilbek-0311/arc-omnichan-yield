// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { RWAVault } from "../contracts/RWAVault.sol";
import { YieldToken } from "../contracts/YieldToken.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RWAVaultTest is Test {
    MockUSDC public usdc;
    RWAVault public vault;
    YieldToken public yRWA;

    address public owner = address(0xABCD);
    address public user = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new RWAVault(address(usdc), owner);
        yRWA = vault.yieldToken();
    }

    function testDepositMintsShares1to1() public {
        uint256 depositAmount = 1_000_000; // 1 USDC with 6 decimals
        usdc.mint(user, depositAmount);

        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount);
        vm.stopPrank();

        assertEq(yRWA.balanceOf(user), depositAmount);
        assertEq(yRWA.totalSupply(), depositAmount);
        assertEq(usdc.balanceOf(address(vault)), depositAmount);
    }

    function testSharePriceUpdatesWithRWAValue() public {
        uint256 depositAmount = 2_000_000; // 2 USDC
        usdc.mint(user, depositAmount);

        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount);
        vm.stopPrank();

        vm.prank(owner);
        vault.updateRWAValue(1_000_000); // +1 USDC in off-chain value

        uint256 expectedSharePrice = ((depositAmount + 1_000_000) * 1e18) / depositAmount;
        assertEq(vault.sharePrice(), expectedSharePrice);
    }

    function testWithdrawUsesSharePrice() public {
        uint256 depositAmount = 1_000_000; // 1 USDC
        usdc.mint(user, depositAmount);

        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount);
        vm.stopPrank();

        vm.prank(owner);
        vault.updateRWAValue(1_000_000); // +1 USDC in off-chain value

        // Simulate USDC liquidity to cover yield
        usdc.mint(address(vault), 1_000_000);

        uint256 sharesToRedeem = depositAmount;
        uint256 expectedOut = (sharesToRedeem * vault.sharePrice()) / 1e18;

        vm.startPrank(user);
        vault.withdraw(sharesToRedeem);
        vm.stopPrank();

        assertEq(yRWA.balanceOf(user), 0);
        assertEq(usdc.balanceOf(user), expectedOut);
    }

    function testWithdrawRevertsIfInsufficientUSDC() public {
        uint256 depositAmount = 1_000_000; // 1 USDC
        usdc.mint(user, depositAmount);

        vm.startPrank(user);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount);
        vm.stopPrank();

        vm.prank(owner);
        vault.updateRWAValue(1_000_000); // +1 USDC value, but no liquidity added

        vm.startPrank(user);
        vm.expectRevert();
        vault.withdraw(depositAmount);
        vm.stopPrank();
    }

    function testUpdateRWAValueOnlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        vault.updateRWAValue(1_000_000);
    }
}
