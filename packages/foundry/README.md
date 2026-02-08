# Arc Omnichain Yield - Smart Contracts

Foundry-based smart contracts for Arc Omnichain Yield vault.

## Contracts

### Core Contracts

- **[RWAVault.sol](contracts/RWAVault.sol)** - Main vault contract that manages USDC deposits, yRWA minting, and yield distribution
- **[YieldToken.sol](contracts/YieldToken.sol)** - ERC20 share token (yRWA) with 6 decimals
- **[ZapReceiver.sol](contracts/ZapReceiver.sol)** - Receives bridged USDC from Circle Gateway and auto-deposits to vault

### Key Features

- **RWAVault**: Accepts USDC, mints yRWA shares, tracks off-chain RWA value
- **Yield Distribution**: 20% fee to treasury, 80% increases share price
- **Share Price**: WAD format (1e18 precision) for accurate calculations
- **ZapReceiver**: Enables one-click cross-chain deposits via Circle CCTP

## Documentation

See the main [README.md](../../README.md) in the root directory for complete documentation, including:

- [Smart Contract Reference](../../README.md#smart-contract-reference) - Full API documentation
- [Deployment Guide](../../README.md#deployment) - Deploy to Arc Testnet
- [Testing](../../README.md#testing) - Run and write tests
- [Precision & Decimals](../../README.md#precision--decimals) - WAD format explained

## Quick Start

### Deploy to Local Network

```bash
# Terminal 1 - Start local chain
yarn chain

# Terminal 2 - Deploy contracts
yarn deploy
```

### Deploy to Arc Testnet

1. Set your private key:
```bash
export PRIVATE_KEY=your-private-key-here
```

2. Deploy RWAVault:
```bash
yarn deploy --network arcTestnet
```

3. Deploy ZapReceiver:
```bash
yarn deploy --file DeployZapReceiver.s.sol --network arcTestnet
```

### Run Tests

```bash
yarn foundry:test
```

## Example Interactions (cast)

### Deposit USDC

```bash
# Approve USDC
cast send $USDC_ADDRESS "approve(address,uint256)" $VAULT_ADDRESS 1000000 --private-key $KEY

# Deposit USDC (mints yRWA 1:1 initially)
cast send $VAULT_ADDRESS "deposit(uint256)" 1000000 --private-key $KEY
```

### Check Share Price

```bash
cast call $VAULT_ADDRESS "sharePrice()(uint256)"
# Returns WAD format (1e18), e.g., 1050000000000000000 = 1.05
```

### Withdraw yRWA

```bash
cast send $VAULT_ADDRESS "withdraw(uint256)" 1000000 --private-key $KEY
```

### Owner Functions

```bash
# Deposit yield (20% fee to treasury, 80% to vault)
cast send $USDC_ADDRESS "approve(address,uint256)" $VAULT_ADDRESS 1000000 --private-key $OWNER_KEY
cast send $VAULT_ADDRESS "depositYield(uint256)" 1000000 --private-key $OWNER_KEY

# Update RWA value (off-chain tracking)
cast send $VAULT_ADDRESS "updateRWAValue(uint256)" 5000000 --private-key $OWNER_KEY
```

## Important Notes

### Share Price (WAD Format)

- `sharePrice()` returns WAD format (1e18 precision)
- Formula: `(totalAssets * 1e18) / totalSupply`
- Use helpers from [vault-helpers.ts](../nextjs/utils/vault-helpers.ts) for conversions

### RWA Value Tracking

- `claimedRWAValue` is maintained off-chain
- Updated by owner via `updateRWAValue(uint256)`
- Not liquid - only USDC balance is withdrawable

### Withdrawal Limits

- Withdrawals revert if vault USDC balance is insufficient
- Check `maxWithdrawable()` before withdrawing
- Admin must deposit yield to increase liquidity

### ZapReceiver Integration

- Receives USDC from Circle Gateway CCTP
- Automatically deposits to vault
- Transfers yRWA to recipient
- Recovery function for failed deposits

## Contract Addresses (Arc Testnet)

- **RWAVault**: `0xa8c1406ff7c71c030b418f99ef039cd746f2d439`
- **ZapReceiver**: Configurable via `NEXT_PUBLIC_ZAP_RECEIVER_ADDRESS`

## Test Coverage

- ✅ Deposit USDC and mint yRWA
- ✅ Withdraw yRWA for USDC
- ✅ Deposit yield with fee distribution
- ✅ Update RWA value
- ✅ Share price calculations
- ✅ Access control (owner functions)
- ✅ ZapReceiver auto-deposit
- ✅ ZapReceiver failure recovery

## Resources

- [Foundry Book](https://book.getfoundry.sh/)
- [Circle CCTP Docs](https://developers.circle.com/stablecoins/docs/cctp-getting-started)
- [Main Documentation](../../README.md)
