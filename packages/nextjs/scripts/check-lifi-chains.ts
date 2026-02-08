/**
 * Quick script to check which chains LiFi supports
 * Run with: npx ts-node --esm scripts/check-lifi-chains.ts
 */
import { getChains } from "@lifi/sdk";

async function checkChains() {
  try {
    console.log("Fetching supported chains from LiFi...\n");
    const chains = await getChains();

    const testnetChainIds = [
      11155111, // Sepolia
      84532, // Base Sepolia
      43113, // Avalanche Fuji
    ];

    const testnetNames: Record<number, string> = {
      11155111: "Ethereum Sepolia",
      84532: "Base Sepolia",
      43113: "Avalanche Fuji",
    };

    console.log("Checking for testnet support:\n");

    for (const chainId of testnetChainIds) {
      const found = chains.find(c => c.id === chainId);
      if (found) {
        console.log(`✅ ${testnetNames[chainId]} (${chainId}) - SUPPORTED`);
        console.log(`   Key: ${found.key}, Name: ${found.name}`);
      } else {
        console.log(`❌ ${testnetNames[chainId]} (${chainId}) - NOT SUPPORTED`);
      }
    }

    console.log(`\nTotal chains supported by LiFi: ${chains.length}`);
    console.log("\nSample of supported chains:");
    chains.slice(0, 10).forEach(chain => {
      console.log(`  - ${chain.name} (ID: ${chain.id}, Mainnet: ${chain.mainnet})`);
    });
  } catch (error) {
    console.error("Error checking LiFi chains:", error);
  }
}

checkChains();
