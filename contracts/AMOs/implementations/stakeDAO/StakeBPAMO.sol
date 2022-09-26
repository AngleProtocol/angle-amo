// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;

import "../../../interfaces/external/stakeDAO/IStakeCurveVault.sol";
import "../../../interfaces/external/stakeDAO/IClaimerRewards.sol";
import "../../../interfaces/external/stakeDAO/ILiquidityGauge.sol";

import "../curve/BaseCurveBPAMO.sol";

/// @title StakeBPAMO
/// @author Angle Core Team
/// @notice AMO depositing tokens on a Curve pool and staking the LP tokens on StakeDAO
/// @dev This AMO can only invest 1 agToken in a Curve pool in which there are only two tokens and in which
/// the agToken is the first token of the pool (like agEUR in the agEUR/EUROC pool)
abstract contract StakeBPAMO is BaseCurveBPAMO {
    uint256[50] private __gapStakeBPAMO;

    // =================================== ERRORS ==================================

    error WithdrawFeeTooLarge();

    // =============================== INITIALIZATION ==============================

    /// @notice Initializes the `AMO` contract
    function initialize(
        address amoMinter_,
        IERC20 agToken_,
        address basePool_
    ) external {
        _initializeBaseCurveBPAMO(amoMinter_, agToken_, basePool_);
    }

    // ========================= INTERNAL STAKEDAO ACTIONS =========================

    /// @inheritdoc BaseCurveAMO
    function _depositLPToken() internal override {
        uint256 balanceLP = IERC20(mainPool).balanceOf(address(this));
        // Approve the vault contract for the Curve LP tokens
        _changeAllowance(IERC20(mainPool), address(_vault()), balanceLP);
        // Deposit the Curve LP tokens into the vault contract and stake
        _vault().deposit(address(this), balanceLP, true);
    }

    /// @inheritdoc BaseCurveAMO
    function _withdrawLPToken() internal override {
        uint256 withdrawalFee = _vault().withdrawalFee();
        if (withdrawalFee > 0) revert WithdrawFeeTooLarge();
        _vault().withdraw(_balanceLPStaked());
    }

    /// @inheritdoc BaseAMO
    function _claimRewards(IERC20[] memory) internal override returns (uint256) {
        _gauge().claim_rewards(address(this));
        return 0;
    }

    /// @inheritdoc BaseCurveAMO
    function _balanceLPStaked() internal view override returns (uint256) {
        return _gauge().balanceOf(address(this));
    }

    // ============================= VIRTUAL FUNCTIONS =============================
    /// @notice StakeDAO Vault address
    function _vault() internal pure virtual returns (IStakeCurveVault);

    /// @notice StakeDAO Gauge address
    function _gauge() internal pure virtual returns (ILiquidityGauge);
}
