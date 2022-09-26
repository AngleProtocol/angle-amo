// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;

import "../ConvexBPAMO.sol";

/// @title ConvexAgEURvEUROCAMO
/// @author Angle Core Team
/// @notice Implements ConvexBPAMO for the pool agEUR-EUROC
contract ConvexAgEURvEUROCAMO is ConvexBPAMO {
    IConvexBaseRewardPool private constant _convexBaseRewardPool =
        IConvexBaseRewardPool(0xA91fccC1ec9d4A2271B7A86a7509Ca05057C1A98);
    uint256 private constant _convexPoolPid = 113;

    /// @inheritdoc ConvexBPAMO
    function _baseRewardPool() internal pure override returns (IConvexBaseRewardPool) {
        return _convexBaseRewardPool;
    }

    /// @inheritdoc ConvexBPAMO
    function _poolPid() internal pure override returns (uint256) {
        return _convexPoolPid;
    }
}
