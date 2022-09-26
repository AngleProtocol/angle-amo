// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;

import "../../../interfaces/external/convex/IBooster.sol";
import "../../../interfaces/external/convex/IBaseRewardPool.sol";
import "../../../interfaces/external/convex/IClaimZap.sol";
import "../../../interfaces/external/convex/ICvxRewardPool.sol";

import "../curve/BaseCurveBPAMO.sol";

/// @title ConvexBPAMO
/// @author Angle Core Team
/// @notice AMO depositing tokens on a Curve pool and staking the LP tokens on Convex
/// @dev This AMO can only invest 1 agXXX in a Curve pool in which there are only two tokens and in which
/// the agToken is the first token of the pool (like agEUR in the agEUR/EUROC pool)
abstract contract ConvexBPAMO is BaseCurveBPAMO {
    /// @notice Convex-related constants
    IConvexBooster private constant _convexBooster = IConvexBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IConvexClaimZap private constant _convexClaimZap = IConvexClaimZap(0xDd49A93FDcae579AE50B4b9923325e9e335ec82B);

    uint256[50] private __gapConvexBPAMO;

    // =============================== INITIALIZATION ==============================

    /// @notice Initializes the `AMO` contract
    function initialize(
        address amoMinter_,
        IERC20 agToken_,
        address basePool_
    ) external {
        _initializeBaseCurveBPAMO(amoMinter_, agToken_, basePool_);
    }

    // ========================== INTERNAL CONVEX ACTIONS ==========================

    /// @inheritdoc BaseCurveAMO
    function _depositLPToken() internal override {
        // Approve the vault contract for the Curve LP tokens
        _changeAllowance(IERC20(mainPool), address(_convexBooster), type(uint256).max);
        // Deposit the Curve LP tokens into the vault contract and stake
        _convexBooster.depositAll(_poolPid(), true);
        _changeAllowance(IERC20(mainPool), address(_convexBooster), 0);
    }

    /// @inheritdoc BaseCurveAMO
    function _withdrawLPToken() internal override {
        _baseRewardPool().withdrawAllAndUnwrap(true);
    }

    /// @inheritdoc BaseAMO
    /// @dev Governance is responsible for handling CRV, CVX rewards claimed through this function
    /// @dev It can be used to pay back part of the debt by swapping it for `agToken`
    /// @dev Currently this implementation does not support external rewards, and if there is any other reward,
    /// this contract should be upgraded to replace the empty arrays
    /// @dev Returned value is unused in this case
    function _claimRewards(IERC20[] memory) internal override returns (uint256) {
        address[] memory rewardContracts = new address[](1);
        rewardContracts[0] = address(_baseRewardPool());

        _convexClaimZap.claimRewards(
            rewardContracts,
            new address[](0),
            new address[](0),
            new address[](0),
            0,
            0,
            0,
            0,
            0
        );
        return 0;
    }

    /// @inheritdoc BaseCurveAMO
    function _balanceLPStaked() internal view override returns (uint256) {
        return _baseRewardPool().balanceOf(address(this));
    }

    // ============================= VIRTUAL FUNCTIONS =============================
    
    /// @notice Address of the Convex contract on which to claim rewards 
    function _baseRewardPool() internal pure virtual returns (IConvexBaseRewardPool);

    /// @notice ID of the pool associated to the AMO on Convex
    function _poolPid() internal pure virtual returns (uint256);
}
