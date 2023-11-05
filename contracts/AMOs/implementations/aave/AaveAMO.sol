// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../../../interfaces/external/aave/IAaveIncentivesController.sol";
import "../../../interfaces/external/aave/ILendingPool.sol";
import "../../../interfaces/external/aave/IProtocolDataProvider.sol";
import "../../../interfaces/external/aave/IAave.sol";
import "./FlashMintLib.sol";

import "../../BaseAMO.sol";
import { IAToken, IVariableDebtToken } from "../../../interfaces/external/aave/IAaveToken.sol";

/// @title AaveAMO
/// @author Angle Core Team
/// @notice AMO interacting with Aave protocol: it supports lending to Aave but also borrowing from there
contract AaveAMO is BaseAMO {
    using SafeERC20 for IERC20;

    struct AaveTokenParams {
        IAToken aToken;
        IVariableDebtToken debtToken;
        uint256 liquidationThreshold;
    }
    // =========================== Constant Addresses ==============================

    address private constant _dai = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    // ========================== Aave Protocol Address ============================

    IAaveIncentivesController private constant _incentivesController =
        IAaveIncentivesController(0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5);

    // ============================== Token Addresses ==============================

    address private constant _aave = 0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9;
    IStakedAave private constant _stkAave = IStakedAave(0x4da27a545c0c5B758a6BA100e3a049001de870f5);

    // ============================== Ops Constants ================================

    uint256 private constant _DEFAULT_COLLAT_MAX_MARGIN = 0.005 ether;
    uint256 private constant _BASE_PARAMS = 1 ether;
    uint256 private constant _BPS_WAD_RATIO = 10**14;

    // =========================== Variables =======================================

    /// @notice List of tokens supported by the AMO
    IERC20[] public activeTokenList;
    /// @notice Mapping to retrieve aToken/debtToken addresses and their associated liquidation
    /// threshold
    mapping(IERC20 => AaveTokenParams) public tokensParams;
    /// @notice Stores the `COOLDOWN_SECONDS` value from the Aave protocol
    uint256 public cooldownSeconds;
    /// @notice Stores the `UNSTAKE_WINDOW` value from the Aave protocol
    uint256 public unstakeWindow;
    /// @notice Parameter used for flash mints
    uint256 public daiBorrowCollatRatio;

    // =========================== Parameters ======================================

    /// @notice Whether we should check for liquidation of the AMO position at each `_pull`
    bool public liquidationCheck;
    /// @notice Protection taken on the default `liquidationThreshold` during health factor checks
    uint256 public liquidationWarningThreshold;

    // =============================== Errors ======================================

    error CloseToLiquidation();
    error NonNullBalances();
    error TooHighParameterValue();

    uint256[50] private __gap;

    // =============================== Initialisation ==============================

    /// @notice Initializes the `AaveAMO` contract
    /// @param amoMinter_ Address of the AMOMinter
    function initialize(address amoMinter_) external {
        _initialize(amoMinter_);
        // Approve swap router spend
        _approveMaxSpend(address(_stkAave), _oneInch);
        _approveMaxSpend(_aave, _oneInch);
        // Approve flashloan spend
        _approveMaxSpend(_dai, FlashMintLib.LENDER);
        _approveMaxSpend(_dai, address(FlashMintLib.LENDING_POOL));
        _setAavePoolVariables();
        liquidationWarningThreshold = 0.02 ether;
    }

    // ====================== External Permissionless Functions ====================

    /// @notice Retrieves stkAave parameters and DAI collat ratio parameters
    /// @dev No access control is needed because this function fetches values from Aave directly.
    /// If something changes on Aave, it will need to be updated here too
    function setAavePoolVariables() external {
        _setAavePoolVariables();
    }

    /// @notice Sets the liquidation threshold for a given set of tokens on Aave
    /// @param tokens Addresses of the tokens to set the liquidation threshold for
    /// @dev Anyone can call this function even on tokens which have not been set: if called on a token
    /// which has not been set, it will populate the mapping without another impact on the AMO
    function setAaveTokenLiqThreshold(IERC20[] memory tokens) external {
        for (uint256 i; i < tokens.length;) {
            _setAaveTokenLiqThreshold(tokens[i]);
            unchecked {
                ++i;
            }
        }
    }

    // ========================== Folding Functions ================================

    /// @notice Allows to unfold the AMO's positions by withdrawing and repaying back (using a flashLoan to avoid
    /// liquidations in the process) what has been borrowed
    /// @param tokens Addresses of the tokens to unfold
    /// @param amounts For each token, amount to unfold, that is to say amount borrowed to be repaid
    /// @dev There shouldn't be any issue on the health factor as you unfold and hence increase your HF
    function unfold(address[] memory tokens, uint256[] memory amounts) external onlyApproved {
        FlashMintLib.doFlashMint(true, amounts, tokens, daiBorrowCollatRatio);
    }

    /// @notice Allows to fold our positions by borrowing and supplying a token with a flash loan to avoid liquidations
    /// @param tokens Addresses of tokens to fold
    /// @param amounts For each token, amount to fold, that is to say amount to borrow and then lend on top of what's
    /// already lent
    /// @dev Currently folding using a token that is not in the activeTokenList is not supported. Could be solved by just adding
    /// necessary tokens
    /// @dev This is an extremely dangerous feature: folding could lead to liquidation
    function fold(address[] memory tokens, uint256[] memory amounts) external onlyApproved {
        FlashMintLib.doFlashMint(false, amounts, tokens, daiBorrowCollatRatio);
        _checkHealthFactor();
    }

    /// @notice Flashload callback, as defined by EIP-3156
    /// @notice We check that the call is coming from the DAI lender and then execute the loan logic
    /// @dev If everything went smoothly, will return `keccak256("ERC3156FlashBorrower.onFlashLoan")`
    function onFlashLoan(
        address initiator,
        address,
        uint256 flashMintAmount,
        uint256,
        bytes calldata data
    ) external returns (bytes32) {
        if (msg.sender != FlashMintLib.LENDER || initiator != address(this)) revert NotApproved();
        (bool deficit, uint256[] memory amounts, address[] memory tokens) = abi.decode(
            data,
            (bool, uint256[], address[])
        );

        return FlashMintLib.loanLogic(deficit, amounts, flashMintAmount, tokens);
    }

    // ========================== Protected Functions ==============================

    /// @notice Changes the liquidation check parameter
    function toggleLiquidationCheck() external onlyApproved {
        liquidationCheck = !liquidationCheck;
    }

    /// @notice Sets the `liquidationWarningThreshold` parameter
    function setLiquidationWarningThreshold(uint256 _liquidationWarningThreshold) external onlyApproved {
        if (_liquidationWarningThreshold > 1 ether) revert TooHighParameterValue();
        liquidationWarningThreshold = _liquidationWarningThreshold;
    }

    // ========================== Internal Actions =================================

    /// @notice Sets Aave addresses for a token which has just previously been added in the `AMOMinter`
    /// @param token Address of the token to fetch addresses for
    function _setToken(IERC20 token) internal override {
        // Set AAVE tokens addresses
        (address aToken_, , address debtToken_) = FlashMintLib.PROTOCOL_DATA_PROVIDER.getReserveTokensAddresses(
            address(token)
        );
        tokensParams[token].aToken = IAToken(aToken_);
        tokensParams[token].debtToken = IVariableDebtToken(debtToken_);
        // Get the liquidation threshold associated to the token
        _setAaveTokenLiqThreshold(token);
        // Allowance for the token may be non null if this token is DAI
        _changeAllowance(token, address(FlashMintLib.LENDING_POOL), type(uint256).max);
        // This will allow the `transferFrom` in the `receiveFromAMO` function in the case where this token is not
        // an agToken
        _approveMaxSpend(address(token), address(amoMinter));
        // Add to the active list of token
        activeTokenList.push(token);
    }

    /// @notice Removes support for a token by deleting the associated Aave addresses
    /// @param token Address of the token to delete storage for
    function _removeToken(IERC20 token) internal override {
        token.safeApprove(address(amoMinter), 0);
        // Need to keep allowance to the lending pool if token is DAI
        if (address(token) != _dai) token.safeApprove(address(FlashMintLib.LENDING_POOL), 0);

        if (
            tokensParams[token].debtToken.balanceOf(address(this)) != 0 ||
            tokensParams[token].aToken.balanceOf(address(this)) != 0
        ) revert NonNullBalances();

        // Deletion from `activeTokenList` loop
        IERC20[] memory tmpActiveTokenList = activeTokenList;
        uint256 amoTokensLength = tmpActiveTokenList.length;
        for (uint256 i; i < amoTokensLength - 1;) {
            if (tmpActiveTokenList[i] == token) {
                // Replace the `amo` to remove with the last of the list
                activeTokenList[i] = activeTokenList[amoTokensLength - 1];
                break;
            }
            unchecked {
                ++i;
            }
        }
        // Remove last element in array
        activeTokenList.pop();

        delete tokensParams[token];
    }

    /// @notice Notifies that tokens have been transferred to the contract and should be lent to Aave and updates the `lastBalances` variable
    /// @param tokens Addresses of tokens received
    /// @param amounts Amounts to invest for each token
    /// @dev In Aave, tokens are directly deposited in the `FlashMintLib.LENDING_POOL`
    function _push(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes[] memory
    ) internal override {
        for (uint256 i; i < tokens.length;) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];
            (uint256 netTokens, uint256 idleTokens) = _report(token, amount);
            lastBalances[token] = netTokens + idleTokens;
            FlashMintLib.LENDING_POOL.deposit(address(token), amount, address(this), 0);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Withdraws tokens for Aave
    /// @param tokens Addresses of each token to be withdrawn
    /// @param amounts Amounts of each token to be withdrawn
    /// @return amountsAvailable Idle amounts in each token available for the `AMOMinter` in the contract
    /// @dev Caller should make sure that `amount` can be withdrawn otherwise the call will revert
    /// @dev In case this contract has some Aave borrowings, this function checks that pulling funds will not
    /// put the AMO in a risky position with respect to liquidations
    function _pull(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes[] memory
    ) internal override returns (uint256[] memory) {
        for (uint256 i; i < tokens.length;) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];
            (uint256 netAssets, uint256 idleTokens) = _report(token, 0);
            if (idleTokens < amount) {
                (uint256 availableLiquidity, , , , , , , , , ) = FlashMintLib.PROTOCOL_DATA_PROVIDER.getReserveData(
                    address(tokens[i])
                );
                if (idleTokens + availableLiquidity > amount) {
                    // If we can withdraw enough from Aave
                    FlashMintLib.LENDING_POOL.withdraw(address(token), amount - idleTokens, address(this));
                    // In this case `amounts[i]` stays equal to `amount`
                    lastBalances[token] = netAssets + idleTokens - amount;
                } else {
                    FlashMintLib.LENDING_POOL.withdraw(address(token), availableLiquidity, address(this));
                    amounts[i] = idleTokens + availableLiquidity;
                    lastBalances[token] = netAssets - availableLiquidity;
                }
            } else {
                amounts[i] = idleTokens;
                lastBalances[token] = netAssets + idleTokens - amount;
            }
            unchecked {
                ++i;
            }
        }
        // Checking if we're not too close to liquidation
        if (liquidationCheck) _checkHealthFactor();
        return amounts;
    }

    /// @notice Claim earned stkAAVE (only called at `harvest`)
    /// @param tokens Addresses of all the tokens to claim rewards for
    /// @dev stkAAVE require a "cooldown" period of 10 days before being claimed
    function _claimRewards(IERC20[] memory tokens) internal override returns (uint256 stkAaveBalance) {
        stkAaveBalance = _balanceOfStkAave();
        // If it's the claim period, then we claim
        if (stkAaveBalance > 0 && _checkCooldown() == 1) {
            // redeem AAVE from stkAave
            _stkAave.claimRewards(address(this), type(uint256).max);
            _stkAave.redeem(address(this), stkAaveBalance);
        }

        // claim stkAave from lending and borrowing, this will reset the cooldown
        _incentivesController.claimRewards(_getAaveAssets(tokens), type(uint256).max, address(this));

        stkAaveBalance = _balanceOfStkAave();

        // request start of cooldown period, if there's no cooldown in progress
        if (stkAaveBalance > 0 && _checkCooldown() == 0) {
            _stkAave.cooldown();
        }
    }

    /// @notice Triggers a cooldown on the stkAAVE contract for this AMO
    function cooldown() external onlyApproved {
        _stkAave.cooldown();
    }

    /// @notice Gets the current position of the strategy for a given token
    /// @param token Token to check the position for
    /// @dev The position for a token is the difference between the amount lent and the amount borrowed
    function _getNavOfInvestedAssets(IERC20 token) internal view override returns (uint256) {
        AaveTokenParams memory aave = tokensParams[token];
        return aave.aToken.balanceOf(address(this)) - aave.debtToken.balanceOf(address(this));
    }

    /// @notice Verifies the cooldown status for earned stkAAVE
    /// @return cooldownStatus Status of the coolDown: if it is 0 then there is no cooldown Status, if it is 1 then
    /// the strategy should claim
    function _checkCooldown() internal view returns (uint256 cooldownStatus) {
        uint256 cooldownStartTimestamp = IStakedAave(_stkAave).stakersCooldowns(address(this));
        uint256 nextClaimStartTimestamp = cooldownStartTimestamp + cooldownSeconds;
        if (cooldownStartTimestamp == 0) {
            return 0;
        }
        if (block.timestamp > nextClaimStartTimestamp && block.timestamp <= nextClaimStartTimestamp + unstakeWindow) {
            return 1;
        }
        if (block.timestamp < nextClaimStartTimestamp) {
            return 2;
        }
    }

    /// @notice Get the deposit and debt tokens for a given token
    function _getAaveAssets(IERC20[] memory tokens) internal view returns (address[] memory assets) {
        assets = new address[](2 * tokens.length);
        for (uint256 i; i < tokens.length;) {
            AaveTokenParams memory aaveAddresses = tokensParams[tokens[i]];
            assets[i * 2] = address(aaveAddresses.aToken);
            assets[i * 2 + 1] = address(aaveAddresses.debtToken);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Internal version of the `_setAavePoolVariables`
    function _setAavePoolVariables() internal {
        cooldownSeconds = IStakedAave(_stkAave).COOLDOWN_SECONDS();
        unstakeWindow = IStakedAave(_stkAave).UNSTAKE_WINDOW();
        (uint256 daiLtv, ) = _getAaveRiskVariables(_dai);
        daiBorrowCollatRatio = daiLtv - _DEFAULT_COLLAT_MAX_MARGIN;
    }

    /// @notice Gets the liquidation threshold and loan to value parameters for a given token on Aave
    /// @param token Address of the token to obtain values for
    /// @dev `getReserveConfigurationData` returns values in base 4. So here `ltv` and `liquidationThreshold` need to be multiplied
    /// by `_BPS_WAD_RATIO` to be put in base 18
    function _getAaveRiskVariables(address token) internal view returns (uint256 ltv, uint256 liquidationThreshold) {
        (, ltv, liquidationThreshold, , , , , , , ) = FlashMintLib.PROTOCOL_DATA_PROVIDER.getReserveConfigurationData(
            token
        );
        // convert bps to BASE_PARAMS
        ltv = ltv * _BPS_WAD_RATIO;
        liquidationThreshold = liquidationThreshold * _BPS_WAD_RATIO;
    }

    /// @notice Computes current health factor and checks if it is under the limit health factor defined by governance.
    /// In this case this function reverts
    function _checkHealthFactor() internal view {
        uint256 healthFactor = type(uint256).max;
        {
            IERC20[] memory tmpActiveTokenList = activeTokenList;

            uint256 depositsInDAI;
            uint256 borrowsInDAI;
            for (uint256 i = 0; i < tmpActiveTokenList.length; i++) {
                // Get current supply and debts in this stablecoin
                AaveTokenParams memory aaveParams = tokensParams[tmpActiveTokenList[i]];
                uint256 tokenDeposits = aaveParams.aToken.balanceOf(address(this));
                uint256 tokenBorrows = aaveParams.debtToken.balanceOf(address(this));
                depositsInDAI +=
                    (FlashMintLib.toDAI(tokenDeposits, address(tmpActiveTokenList[i])) *
                        aaveParams.liquidationThreshold) /
                    _BASE_PARAMS;
                borrowsInDAI += FlashMintLib.toDAI(tokenBorrows, address(tmpActiveTokenList[i]));
            }

            if (borrowsInDAI > 0) healthFactor = (depositsInDAI * _BASE_PARAMS) / borrowsInDAI;
        }

        if (healthFactor <= _BASE_PARAMS) revert CloseToLiquidation();
    }

    /// @notice Returns the `StkAAVE` balance
    function _balanceOfStkAave() internal view returns (uint256) {
        return IERC20(address(_stkAave)).balanceOf(address(this));
    }

    /// @notice Sets the liquidation threshold for an individual token by reading Aave values
    function _setAaveTokenLiqThreshold(IERC20 token) internal {
        (, uint256 liquidationThreshold) = _getAaveRiskVariables(address(token));
        tokensParams[token].liquidationThreshold = liquidationThreshold - liquidationWarningThreshold;
    }
}
