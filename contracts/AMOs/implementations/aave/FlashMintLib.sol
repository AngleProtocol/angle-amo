// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import "../../../interfaces/external/aave/ILendingPool.sol";
import "../../../interfaces/external/aave/IProtocolDataProvider.sol";
import "../../../interfaces/external/aave/IAave.sol";

/// @title FlashMintLib
/// @author Angle Core Team, with inspiration from Yearn FlashMintLib
/// @notice Library used to deposit collateral on Aave, to borrow from there using flash loans to avoid being liquidated
library FlashMintLib {
    // ======================= Aave and DAI Protocol Addresses =====================

    address public constant LENDER = 0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853;
    IProtocolDataProvider public constant PROTOCOL_DATA_PROVIDER =
        IProtocolDataProvider(0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d);
    ILendingPool public constant LENDING_POOL = ILendingPool(0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9);

    // ================================== Constants ================================

    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
    uint256 private constant _DAI_DECIMALS = 1e18;
    uint256 private constant _COLLAT_RATIO_PRECISION = 1 ether;
    uint256 private constant _RAY = 10**27;
    uint16 private constant _referral = 0;

    // ============================= Base Tokens Addresses =========================

    address private constant _WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address private constant _DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    // ================================== Error ====================================

    error NonNullFlashMintFee();

    /// @notice Performs a DAI flash loan to either borrow tokens from Aave or simply repay debt
    /// @param deficit Whether we should repay our debt from Aave or borrow (`deficit = true` means repaying debt)
    /// @param amountsDesired For each token, amount to repay or to borrow
    /// @param tokens Tokens to repay or to borrow
    /// @param collatRatioDAI Aave parameter for the loan to value of DAI with a safety margin
    function doFlashMint(
        bool deficit,
        uint256[] memory amountsDesired,
        address[] memory tokens,
        uint256 collatRatioDAI
    ) internal {
        address dai = _DAI;
        // Calculate the amount of DAI we need
        uint256 requiredDAI;
        // Array used in case of to find out how much DAI we need to borrow for each asset that needs
        // to be folded
        uint256[] memory proportionFlashLoan = new uint256[](tokens.length);
        {
            uint256 requiredDAIUnscaled;
            for (uint256 i = 0; i < tokens.length; i++) {
                proportionFlashLoan[i] = toDAI(amountsDesired[i], tokens[i]);
                requiredDAIUnscaled += proportionFlashLoan[i];
            }
            requiredDAI = (requiredDAIUnscaled * _COLLAT_RATIO_PRECISION) / collatRatioDAI;
            uint256 _maxLiquidity = IERC3156FlashLender(LENDER).maxFlashLoan(_DAI);

            /*
            When depositing/withdrawing in the `lendingPool` the amounts are scaled by a `liquidityIndex` and rounded with the functions rayDiv and rayMul (in the aDAI contract)
            Weirdly, 2 different indexes are used: `liquidityIndex` is used when depositing and `getReserveNormalizedIncome` when withdrawing
            Therefore, we need to round `requiredDAI`, or we may get some rounding errors and execution could revert
            because the amount we try to withdraw (to pay back the flashloan) is not equal to the amount deposited
            */
            uint256 liquidityIndex = LENDING_POOL.getReserveData(dai).liquidityIndex;
            uint256 getReserveNormalizedIncome = LENDING_POOL.getReserveNormalizedIncome(dai);
            uint256 rayDiv = ((requiredDAI * _RAY + liquidityIndex / 2) / liquidityIndex);
            requiredDAI = (rayDiv * getReserveNormalizedIncome + (_RAY / 2)) / _RAY;

            if (requiredDAI > _maxLiquidity) {
                requiredDAI = (_maxLiquidity * _RAY - (_RAY / 2)) / getReserveNormalizedIncome;
                requiredDAI = (requiredDAI * liquidityIndex - liquidityIndex / 2) / _RAY;

                // NOTE: if DAI liquidity that can be taken is capped, we need to correct the amounts taken for each flashLoan
                for (uint256 i = 0; i < tokens.length; i++) {
                    amountsDesired[i] =
                        (fromDAI((requiredDAI * proportionFlashLoan[i]) / requiredDAIUnscaled, tokens[i]) *
                            collatRatioDAI) /
                        _COLLAT_RATIO_PRECISION;
                }
            }
        }

        // Check that fees have not been increased without us knowing
        if (IERC3156FlashLender(LENDER).flashFee(dai, requiredDAI) != 0) revert NonNullFlashMintFee();
        bytes memory data = abi.encode(deficit, amountsDesired, tokens);
        IERC3156FlashLender(LENDER).flashLoan(IERC3156FlashBorrower(address(this)), dai, requiredDAI, data);
    }

    /// @notice Actually performs the deposits and the flash loan
    /// @param deficit Whether we should repay our debt from Aave or borrow (`deficit = true` means repaying debt)
    /// @param amounts For each token, amount to repay or to borrow
    /// @param amountFlashmint Size of the DAI flash loan to perform
    /// @param tokens Tokens to repay or to borrow
    function loanLogic(
        bool deficit,
        uint256[] memory amounts,
        uint256 amountFlashmint,
        address[] memory tokens
    ) internal returns (bytes32) {
        address dai = _DAI;

        ILendingPool lp = LENDING_POOL;

        // 1. Deposit DAI in Aave as collateral
        lp.deposit(dai, amountFlashmint, address(this), _referral);

        if (deficit) {
            for (uint256 i = 0; i < tokens.length; i++) {
                // 2a. if in deficit withdraw amount and repay it
                lp.withdraw(tokens[i], amounts[i], address(this));
                lp.repay(tokens[i], amounts[i], 2, address(this));
            }
        } else {
            for (uint256 i = 0; i < tokens.length; i++) {
                // 2b. if levering up borrow and deposit
                lp.borrow(tokens[i], amounts[i], 2, _referral, address(this));
                lp.deposit(tokens[i], amounts[i], address(this), _referral);
            }
        }
        // 3. Withdraw DAI
        lp.withdraw(dai, amountFlashmint, address(this));

        return CALLBACK_SUCCESS;
    }

    function priceOracle() internal view returns (IPriceOracle) {
        return IPriceOracle(PROTOCOL_DATA_PROVIDER.ADDRESSES_PROVIDER().getPriceOracle());
    }

    /// @notice Calculates the DAI value of `amount` of `asset`
    function toDAI(uint256 _amount, address asset) internal view returns (uint256) {
        address dai = _DAI;
        if (_amount == 0 || _amount == type(uint256).max || asset == dai) {
            return _amount;
        }

        if (asset == _WETH) {
            return
                (_amount * (uint256(10)**uint256(IOptionalERC20(dai).decimals()))) / priceOracle().getAssetPrice(dai);
        }

        address[] memory tokens = new address[](2);
        tokens[0] = asset;
        tokens[1] = dai;
        uint256[] memory prices = priceOracle().getAssetsPrices(tokens);

        uint256 ethPrice = (_amount * prices[0]) / (uint256(10)**uint256(IOptionalERC20(asset).decimals()));
        return (ethPrice * _DAI_DECIMALS) / prices[1];
    }

    /// @notice Calculates the asset value of `amount` of `asset` expressed in DAI value
    function fromDAI(uint256 _amount, address asset) internal view returns (uint256) {
        address dai = _DAI;
        if (_amount == 0 || _amount == type(uint256).max || asset == dai) {
            return _amount;
        }

        if (asset == _WETH) {
            return
                (_amount * priceOracle().getAssetPrice(dai)) / (uint256(10)**uint256(IOptionalERC20(dai).decimals()));
        }

        address[] memory tokens = new address[](2);
        tokens[0] = asset;
        tokens[1] = dai;
        uint256[] memory prices = priceOracle().getAssetsPrices(tokens);

        uint256 ethPrice = (_amount * prices[1]) / _DAI_DECIMALS;

        return (ethPrice * (uint256(10)**uint256(IOptionalERC20(asset).decimals()))) / prices[0];
    }
}
