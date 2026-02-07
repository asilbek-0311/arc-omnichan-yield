// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { ZapReceiver } from "../contracts/ZapReceiver.sol";

/**
 * @notice Deployment script for ZapReceiver contract
 * @dev Run with: yarn deploy --file DeployZapReceiver.s.sol --network arcTestnet
 *
 * Required environment variables:
 * - RWA_VAULT_ADDRESS: Address of the deployed RWAVault
 * - USDC_ADDRESS: Address of USDC token on target chain
 */
contract DeployZapReceiver is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        address vaultAddress = vm.envAddress("RWA_VAULT_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");

        console.log("Deploying ZapReceiver...");
        console.log("  Vault:", vaultAddress);
        console.log("  USDC:", usdcAddress);
        console.log("  Owner:", deployer);

        ZapReceiver zapReceiver = new ZapReceiver(vaultAddress, usdcAddress, deployer);

        console.log("ZapReceiver deployed at:", address(zapReceiver));
        console.log("");
        console.log("Next steps:");
        console.log("1. Update packages/nextjs/.env with:");
        console.log("   NEXT_PUBLIC_ZAP_RECEIVER_ADDRESS=%s", address(zapReceiver));
        console.log("2. Verify contract:");
        console.log("   yarn verify --network arcTestnet");
        console.log("3. Test deposit flow from source chain");
    }
}
