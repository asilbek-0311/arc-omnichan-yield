# Next.js App Notes

## Arc Testnet USDC

- Native gas token on Arc Testnet uses **USDC with 18 decimals**.
- The ERC-20 USDC contract uses **6 decimals**.
- For balances and transfers, rely on the ERC-20 interface (`decimals()`), not the native currency.
