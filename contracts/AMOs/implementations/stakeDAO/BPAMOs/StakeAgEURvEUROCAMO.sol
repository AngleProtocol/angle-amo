// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;

import "../StakeBPAMO.sol";

/// @title StakeAgEURvEUROCAMO
/// @author Angle Core Team
/// @notice Implements StakeBPAMO for the pool agEUR-EUROC
contract StakeAgEURvEUROCAMO is StakeBPAMO {
    IStakeCurveVault private constant _stakeDAOVault = IStakeCurveVault(0xDe46532a49c88af504594F488822F452b7FBc7BD);
    ILiquidityGauge private constant _liquidityGauge = ILiquidityGauge(0x63f222079608EEc2DDC7a9acdCD9344a21428Ce7);

    /// @inheritdoc StakeBPAMO
    function _vault() internal pure override returns (IStakeCurveVault) {
        return _stakeDAOVault;
    }

    /// @inheritdoc StakeBPAMO
    function _gauge() internal pure override returns (ILiquidityGauge) {
        return _liquidityGauge;
    }
}
