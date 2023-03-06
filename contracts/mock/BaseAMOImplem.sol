// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../AMOs/BaseAMO.sol";
import "../interfaces/IAMO.sol";

/// @title BaseAMOImplem
/// @author Angle Core Team
/// @notice This is a mock base contract to be used for testing
contract BaseAMOImplem is BaseAMO {
    mapping(address => uint256) public netAssets;
    mapping(address => uint256) public amountsReallyAvailable;
    uint256 public counter;

    function initialize(address amoMinter_) external {
        _initialize(amoMinter_);
    }

    function report(IERC20 token, uint256 amountAdded) external returns (uint256, uint256) {
        return _report(token, amountAdded);
    }

    function revertBytes(bytes memory errMsg) external pure {
        _revertBytes(errMsg);
    }

    function approveMaxSpend(address token, address spender) external {
        _approveMaxSpend(token, spender);
    }

    function _getNavOfInvestedAssets(IERC20 token) internal view override returns (uint256 amountInvested) {
        amountInvested = netAssets[address(token)];
    }

    function setNetAssets(address token, uint256 netAssetsValue) external {
        netAssets[token] = netAssetsValue;
    }

    function setLastBalance(IERC20 token, uint256 lastBalance) external {
        lastBalances[token] = lastBalance;
    }

    function setAmountsAvailable(address token, uint256 amount) external {
        amountsReallyAvailable[token] = amount;
    }

    function _pull(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes[] memory
    ) internal override returns (uint256[] memory) {
        uint256[] memory amountsAvailable = new uint256[](amounts.length);
        counter += 1;
        for (uint256 i = 0; i < tokens.length; i++) {
            amountsAvailable[i] = amountsReallyAvailable[address(tokens[i])];
        }
        return amountsAvailable;
    }
}

/// @title BaseAMOImplem2
/// @author Angle Core Team
contract BaseAMOImplem2 is BaseAMO {
    function initialize(address amoMinter_) external {
        _initialize(amoMinter_);
    }
}
