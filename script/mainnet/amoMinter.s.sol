// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import "../../contracts/amoMinter/AMOMinter.sol";
import "../../contracts/AMOs/implementations/curve/BPAMOs/MultiStakerCurveAgEURvEUROCAMO.sol";
import "../../contracts/keeperJobs/curve/BPAMOJob.sol";
import "./mainnet.sol";

contract DeployAMOMinter is Script, MainnetConstants {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY_MAINNET");

        vm.startBroadcast(deployerPrivateKey);

        AMOMinter amoMinterImplementation = new AMOMinter();
        AMOMinter amoMinter = AMOMinter(
            deployUpgradeable(
                address(amoMinterImplementation),
                abi.encodeWithSelector(amoMinterImplementation.initialize.selector, CORE_BORROW)
            )
        );

        vm.stopBroadcast();
    }
}
