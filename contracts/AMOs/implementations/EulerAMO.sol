// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../../interfaces/external/euler/IEuler.sol";

import "../BaseAMO.sol";

/// @title EulerAMO
/// @author Angle Core Team
/// @notice AMO interacting with Euler.
contract EulerAMO is BaseAMO {
    using SafeERC20 for IERC20;

    struct EulerAddresses {
        IEulerEToken eToken;
        IEulerDToken dToken;
    }

    // ========================== Euler Protocol Addresses ==========================

    IEuler private constant _euler = IEuler(0x27182842E098f60e3D576794A5bFFb0777E025d3);
    IEulerMarkets private constant _eulerMarkets = IEulerMarkets(0x3520d5a913427E6F0D6A83E07ccD4A4da316e4d3);

    // ==============================  Parameters and Variables ==============================

    /// @notice Mapping to retieve aToken/debtToken addresses
    mapping(IERC20 => EulerAddresses) public tokensAddresses;

    uint256[50] private __gap;

    // =============================== Initialisation ======================================

    /// @notice Initializes the `AMO` contract
    /// @param amoMinter_ Address of the AMOMinter
    function initialize(address amoMinter_) external {
        _initialize(amoMinter_);
    }

    // ========================== Internal Actions =================================

    /// @notice Set Euler addresses only when `token` has been added to the amo in the `AMOMinter`
    /// @param token Address of the token to fetch addresses for
    function _setToken(IERC20 token) internal override {
        // Set Euler tokens address
        IEulerEToken eToken = IEulerEToken(_eulerMarkets.underlyingToEToken(address(token)));
        IEulerDToken dToken = IEulerDToken(_eulerMarkets.underlyingToDToken(address(token)));

        tokensAddresses[token].eToken = eToken;
        tokensAddresses[token].dToken = dToken;
        // This will allow the burnFrom in the `burnFromAMO` function
        _approveMaxSpend(address(token), address(amoMinter));
    }

    /// @notice Remove Euler addresses from a token which has been removed from the amo in the `AMOMinter`
    /// @param token Address of the token to delete storage for
    function _removeToken(IERC20 token) internal override {
        token.safeApprove(address(amoMinter), 0);
        delete tokensAddresses[token];
    }

    /// @notice Notify that tokens has been transferred to the contract and invests these tokens on Euler
    /// @param tokens Addresses of each token received
    /// @param amounts Amounts of each token to be invested
    /// @dev In Euler it is directly deposited in the LendingPool
    function _push(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes[] memory
    ) internal override {
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];
            (uint256 lentTokens, uint256 idleTokens) = _report(token, amount);
            lastBalances[token] = lentTokens + idleTokens;
            EulerAddresses memory eulerAddress = tokensAddresses[token];
            _changeAllowance(token, address(_euler), amount);
            eulerAddress.eToken.deposit(0, amount);
        }
    }

    /// @notice Withdraws tokens to reimburse the AMOMinter
    /// @param tokens Addresses of tokens to be withdrawn
    /// @param amounts Amounts to withdraw for each token
    /// @return amountAvailables Idle amounts in each token after the `_pull`
    function _pull(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes[] memory
    ) internal override returns (uint256[] memory) {
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];
            (uint256 netAssets, uint256 idleTokens) = _report(token, 0);
            if (idleTokens < amount) {
                uint256 availableLiquidity = token.balanceOf(address(_euler));
                IEulerEToken eToken = tokensAddresses[token].eToken;
                if (idleTokens + availableLiquidity > amount) {
                    // If we can withdraw enough from Euler
                    eToken.withdraw(0, amount - idleTokens);
                    // In this case `amounts[i]` stays equal to `amount`
                    lastBalances[token] = netAssets + idleTokens - amount;
                } else {
                    eToken.withdraw(0, availableLiquidity);
                    amounts[i] = idleTokens + availableLiquidity;
                    lastBalances[token] = netAssets - availableLiquidity;
                }
            } else {
                amounts[i] = idleTokens;
                // should be approximately +/- 1 to the new deposit-borrow if there has been a withdraw
                lastBalances[token] = netAssets + idleTokens - amount;
            }
        }
        return amounts;
    }

    /// @notice Get the current position of the strategy: that is to say the amount deposited
    /// and the amount borrowed on Euler
    /// @dev The actual underlying amount owned is `deposits - borrows`
    function _getNavOfInvestedAssets(IERC20 token) internal view override returns (uint256 netAssets) {
        // get current supply and debts in this stablecoin
        EulerAddresses memory euler = tokensAddresses[token];
        uint256 deposits = euler.eToken.balanceOfUnderlying(address(this));
        uint256 borrows = euler.dToken.balanceOf(address(this));
        netAssets = deposits - borrows;
    }
}
