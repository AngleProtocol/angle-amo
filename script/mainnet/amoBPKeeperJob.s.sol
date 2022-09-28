// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "forge-std/Script.sol";
import "../../contracts/amoMinter/AMOMinter.sol";
import "../../contracts/AMOs/implementations/curve/BPAMOs/MultiStakerCurveAgEURvEUROCAMO.sol";
import "../../contracts/keeperJobs/curve/BPAMOJob.sol";
import "./mainnet.sol";

contract DeployAMOBP is Script, MainnetConstants {
    address public constant AGEUR = 0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8;
    address public constant AGEUR_EUROC_CURVE_POOL = 0xBa3436Fd341F2C8A928452Db3C5A3670d1d5Cc73;
    AMOMinter public constant amoMinter = AMOMinter(0xec876Edc3F1a24c99d7c56F017E1D51581952F84);

    error ZeroAdress();

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY_MAINNET");

        vm.startBroadcast(deployerPrivateKey);

        if (address(amoMinter) == address(0)) revert ZeroAdress();

        MultiStakerCurveAgEURvEUROCAMO amoImplementation = new MultiStakerCurveAgEURvEUROCAMO();
        MultiStakerCurveAgEURvEUROCAMO amo = MultiStakerCurveAgEURvEUROCAMO(
            deployUpgradeable(
                address(amoImplementation),
                abi.encodeWithSelector(
                    amoImplementation.initialize.selector,
                    amoMinter,
                    IERC20(address(AGEUR)),
                    IMetaPool(address(AGEUR_EUROC_CURVE_POOL))
                )
            )
        );

        BPAMOJob keeperJobImplementation = new BPAMOJob();
        BPAMOJob keeperJob = BPAMOJob(
            deployUpgradeable(
                address(keeperJobImplementation),
                abi.encodeWithSelector(keeperJobImplementation.initialize.selector, amoMinter)
            )
        );

        vm.stopBroadcast();
    }
}
