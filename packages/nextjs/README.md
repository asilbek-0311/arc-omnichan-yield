# Arc Omnichain Yield - Frontend

Frontend application for Arc Omnichain Yield vault built with Next.js, RainbowKit, Wagmi, and Viem.

## Features

- One-Click Zap with LiFi token swaps
- Multi-chain USDC deposits via Circle CCTP
- Vault position tracking and withdrawals
- Admin panel for treasury management
- Transaction history and recovery

## Documentation

See the main [README.md](../../README.md) in the root directory for complete documentation, including:

- [Architecture Overview](../../README.md#architecture-overview)
- [Getting Started](../../README.md#getting-started)
- [Deployment](../../README.md#deployment)
- [Frontend Hooks Documentation](../../README.md#key-hooks)
- [Configuration Guide](../../README.md#configuration)
- [Troubleshooting](../../README.md#troubleshooting)

## Quick Start

```bash
# Install dependencies (from root)
yarn install

# Start local development
yarn start
```

Visit: `http://localhost:3000`

## Important Notes

### Arc Testnet USDC

- Native gas token on Arc Testnet uses **USDC with 18 decimals**
- The ERC-20 USDC contract uses **6 decimals**
- For balances and transfers, rely on the ERC-20 interface (`decimals()`), not the native currency

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

- Circle Gateway addresses and API keys
- LiFi API key (optional)
- Admin allowlist addresses
- ZapReceiver contract address

See [Environment Variables](../../README.md#environment-variables) section in main README for full details.

## Key Technologies

- **Next.js** - React framework with App Router
- **RainbowKit** - Wallet connection
- **Wagmi** - React hooks for Ethereum
- **Viem** - TypeScript Ethereum library
- **Tailwind CSS** + **DaisyUI** - Styling
