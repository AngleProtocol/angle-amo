// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../../contracts/external/ProxyAdmin.sol";
import "../../contracts/external/TransparentUpgradeableProxy.sol";

contract MainnetConstants {
    address public constant GOVERNOR = 0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8;
    address public constant GUARDIAN = 0x0C2553e4B9dFA9f83b1A6D3EAB96c4bAaB42d430;
    address public constant PROXY_ADMIN = 0x1D941EF0D3Bba4ad67DBfBCeE5262F4CEE53A32b;
    address public constant CORE_BORROW = 0x5bc6BEf80DA563EBf6Df6D6913513fa9A7ec89BE;

    function deployUpgradeable(address implementation, bytes memory data) public returns (address) {
        return address(new TransparentUpgradeableProxy(implementation, PROXY_ADMIN, data));
    }
}
