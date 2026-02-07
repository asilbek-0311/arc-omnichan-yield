//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { RWAVault } from "../contracts/RWAVault.sol";

/**
 * @notice Main deployment script for all contracts
 * @dev Run this when you want to deploy multiple contracts at once
 *
 * Example: yarn deploy # runs this script(without`--file` flag)
 */
contract DeployScript is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // Deploys all your contracts sequentially
        // Add new deployments here when needed
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address treasuryAddress = vm.envAddress("TREASURY_ADDRESS");
        new RWAVault(usdcAddress, deployer, treasuryAddress);

        // Deploy additional contracts here
        // Example:
        // DeployMyContract myContract = new DeployMyContract();
        // myContract.run();
    }
}
