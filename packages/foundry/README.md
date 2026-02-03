# RWA Yield Vault (Foundry)

This package contains a simple, production-ready RWA yield vault and share token:

- `RWAVault`: accepts USDC, mints yRWA 1:1, and tracks off-chain RWA value.
- `YieldToken` (yRWA): ERC20 share token with 6 decimals.

## Contracts

- `contracts/RWAVault.sol`
- `contracts/YieldToken.sol`

## Deploy

Set the USDC address for the target network:

```bash
export USDC_ADDRESS=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

Run the deployment script:

```bash
yarn deploy --file Deploy.s.sol
```

## Test

```bash
forge test
```

## Example Interactions (cast)

Approve and deposit:

```bash
cast send <USDC_ADDRESS> "approve(address,uint256)" <VAULT_ADDRESS> 1000000 --private-key <KEY>
cast send <VAULT_ADDRESS> "deposit(uint256)" 1000000 --private-key <KEY>
```

Check share price:

```bash
cast call <VAULT_ADDRESS> "sharePrice()(uint256)"
```

Withdraw:

```bash
cast send <VAULT_ADDRESS> "withdraw(uint256)" 1000000 --private-key <KEY>
```

## Notes

- `sharePrice()` returns WAD (1e18 precision).
- `totalRWAValue` is maintained off-chain and updated by the owner via `updateRWAValue`.
- Withdrawals revert if the vault's USDC balance is insufficient to cover `amountOut`.
