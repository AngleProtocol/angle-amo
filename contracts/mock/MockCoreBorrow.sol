// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "../interfaces/ICoreBorrow.sol";

contract MockCoreBorrow is ICoreBorrow {
    mapping(address => bool) public governors;
    mapping(address => bool) public guardians;

    function isGovernor(address admin) external view override returns (bool) {
        return governors[admin];
    }

    function isGovernorOrGuardian(address admin) external view override returns (bool) {
        return guardians[admin] || governors[admin];
    }

    function toggleGovernor(address admin) external {
        governors[admin] = !governors[admin];
    }

    function toggleGuardian(address admin) external {
        guardians[admin] = !guardians[admin];
    }
}