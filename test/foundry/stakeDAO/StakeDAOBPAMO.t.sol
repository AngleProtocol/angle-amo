// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";

import "../BaseTest.t.sol";
import "../../../contracts/amoMinter/AMOMinter.sol";
import "../../../contracts/AMOs/implementations/stakeDAO/BPAMOs/StakeAgEURvEUROCAMO.sol";
import "../../../contracts/keeperJobs/curve/BPAMOJob.sol";
import "../../../contracts/interfaces/external/stakeDAO/IStakeCurveVault.sol";
import "../../../contracts/interfaces/external/stakeDAO/ILiquidityGauge.sol";
import "../../../contracts/interfaces/external/curve/IMetaPool2.sol";
import "../../../contracts/interfaces/ITreasury.sol";

contract StakeBPAMOTest is BaseTest {
    using stdStorage for StdStorage;

    int128 public constant STABLE_IDX = 0;
    uint256 public constant decimalNormalizer = 10**12;

    ITreasury public constant treasury = ITreasury(0x8667DBEBf68B0BFa6Db54f550f41Be16c4067d60);
    IStakeCurveVault public constant _stakeDAOVault = IStakeCurveVault(0xDe46532a49c88af504594F488822F452b7FBc7BD);
    ILiquidityGauge public constant _liquidityGauge = ILiquidityGauge(0x63f222079608EEc2DDC7a9acdCD9344a21428Ce7);
    address public constant curveStrategy = 0x20F1d4Fed24073a9b9d388AfA2735Ac91f079ED6;
    address public constant sdtDistributor = 0x9C99dffC1De1AfF7E7C1F36fCdD49063A281e18C;
    IERC20 public constant CRV = IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);
    IERC20 public constant SDT = IERC20(0x73968b9a57c6E53d41345FD57a6E6ae27d6CDB2F);
    address public constant SDTGovernance = 0xF930EBBd05eF8b25B1797b9b2109DDC9B0d43063;

    // Can be changed depending on the pools to be tested
    IAgToken public agToken = IAgToken(0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8);
    IERC20 public collateral = IERC20(0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c);
    IMetaPool2 public mainPool = IMetaPool2(0xBa3436Fd341F2C8A928452Db3C5A3670d1d5Cc73);
    uint256 public fee = 4 * 10**5;

    uint256 private _ethereum;

    AMOMinter public amoMinter;
    BPAMOJob public keeperJob;
    StakeAgEURvEUROCAMO public amo;

    StakeAgEURvEUROCAMO public amoImplementation;
    AMOMinter public amoMinterImplementation;
    BPAMOJob public keeperJobImplementation;

    function setUp() public override {
        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15573311);
        vm.selectFork(_ethereum);

        super.setUp();

        amoMinterImplementation = new AMOMinter();
        amoMinter = AMOMinter(
            deployUpgradeable(
                address(amoMinterImplementation),
                abi.encodeWithSelector(amoMinterImplementation.initialize.selector, coreBorrow)
            )
        );
        amoImplementation = new StakeAgEURvEUROCAMO();
        amo = StakeAgEURvEUROCAMO(
            deployUpgradeable(
                address(amoImplementation),
                abi.encodeWithSelector(
                    amoImplementation.initialize.selector,
                    amoMinter,
                    IERC20(address(agToken)),
                    IMetaPool(address(mainPool))
                )
            )
        );
        keeperJobImplementation = new BPAMOJob();
        keeperJob = BPAMOJob(
            deployUpgradeable(
                address(keeperJobImplementation),
                abi.encodeWithSelector(keeperJobImplementation.initialize.selector, amoMinter, 0)
            )
        );

        // add the amo and the token
        vm.startPrank(_GOVERNOR);
        treasury.addMinter(address(amoMinter));
        amoMinter.addAMO(amo);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(agToken)), type(uint256).max);
        vm.stopPrank();
    }

    // ================================= INITIALIZE ================================

    function testInitalizeZeroAddress() public {
        vm.expectRevert(BaseAMOStorage.ZeroAddress.selector);
        amo = StakeAgEURvEUROCAMO(
            deployUpgradeable(
                address(amoImplementation),
                abi.encodeWithSelector(amoImplementation.initialize.selector, address(0), agToken, address(mainPool))
            )
        );

        vm.expectRevert(BaseAMOStorage.ZeroAddress.selector);
        amo = StakeAgEURvEUROCAMO(
            deployUpgradeable(
                address(amoImplementation),
                abi.encodeWithSelector(amoImplementation.initialize.selector, amoMinter, address(0), address(mainPool))
            )
        );

        vm.expectRevert(BaseAMOStorage.ZeroAddress.selector);
        amo = StakeAgEURvEUROCAMO(
            deployUpgradeable(
                address(amoImplementation),
                abi.encodeWithSelector(amoImplementation.initialize.selector, amoMinter, agToken, address(0))
            )
        );
    }

    function testAlreadyInitalized() public {
        vm.expectRevert(bytes("Initializable: contract is already initialized"));
        vm.prank(_bob);
        amo.initialize(address(amoMinter), IERC20(address(agToken)), address(mainPool));
    }

    function testInitalize() public {
        assertEq(address(amo.agToken()), address(agToken));
        assertEq(amo.mainPool(), address(mainPool));
        assertEq(address(amo.amoMinter()), address(amoMinter));
    }

    // =============================== VIEW FUNCTION ===============================

    function testKeeperInfo() public {
        (address _mainPool, address _agToken, uint256 _index) = amo.keeperInfo();
        assertEq(address(mainPool), _mainPool);
        assertEq(address(agToken), address(_agToken));
        assertEq(0, _index);
    }

    // ==================================== PUSH ===================================

    function testPushRevertWrongLength(uint256 mintAmount, uint256 collatAmount) public {
        mintAmount = bound(mintAmount, 0, 1_000_000 ether);
        collatAmount = bound(collatAmount, 0, 1_000_000 * 10**6);

        IERC20[] memory tokens = new IERC20[](2);
        bool[] memory isStablecoin = new bool[](2);
        uint256[] memory amounts = new uint256[](2);
        bytes[] memory data = new bytes[](0);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = mintAmount;

        deal(address(collateral), address(amoMinter), collatAmount);
        tokens[1] = IERC20(address(collateral));
        isStablecoin[1] = false;
        amounts[1] = collatAmount;

        startHoax(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        vm.expectRevert(BaseAMOStorage.IncompatibleLengths.selector);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
    }

    function testPushRevertWrongToken(uint256 collatAmount) public {
        collatAmount = bound(collatAmount, 0, 1_000_000 * 10**6);

        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](0);

        deal(address(collateral), address(amoMinter), collatAmount);
        tokens[0] = IERC20(address(collateral));
        isStablecoin[0] = false;
        amounts[0] = collatAmount;

        startHoax(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        vm.expectRevert(BaseCurveAMO.IncompatibleTokens.selector);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
    }

    function testPushSimple(uint256 mintAmount) public {
        mintAmount = bound(mintAmount, 2, 1_000_000_000 ether);

        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = mintAmount;
        data[0] = abi.encode(0);

        uint256 prevAgTokenBalanceCurve = agToken.balanceOf(address(mainPool));
        uint256 prevCollateralBalanceCurve = collateral.balanceOf(address(mainPool));
        uint256 prevlpTokenSupply = mainPool.totalSupply();
        uint256 prevGovAgEURBalance = agToken.balanceOf(_GOVERNOR);

        assertEq(_liquidityGauge.balanceOf(address(amo)), 0);
        assertEq(amo.lastBalances(IERC20(address(agToken))), 0);
        assertEq(amo.protocolDebts(IERC20(address(agToken))), 0);
        assertEq(amo.protocolGains(IERC20(address(agToken))), 0);

        startHoax(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);

        assertEq(amo.lastBalances(IERC20(address(agToken))), mintAmount);
        assertEq(amo.protocolDebts(IERC20(address(agToken))), 0);
        assertEq(amo.protocolGains(IERC20(address(agToken))), 0);

        assertEq(agToken.balanceOf(address(mainPool)), prevAgTokenBalanceCurve + mintAmount);
        assertEq(collateral.balanceOf(address(mainPool)), prevCollateralBalanceCurve);
        assertEq(agToken.balanceOf(_GOVERNOR), prevGovAgEURBalance);
        assertEq(collateral.balanceOf(_GOVERNOR), 0);

        assertEq(mainPool.balanceOf(address(amo)), 0);
        assertEq(mainPool.balanceOf(address(amoMinter)), 0);
        assertEq(mainPool.balanceOf(address(_GOVERNOR)), 0);
        assertEq(_liquidityGauge.balanceOf(address(amo)), mainPool.totalSupply() - prevlpTokenSupply);
    }

    function testPushGainDebtsMultiTx(
        uint256 mintAmount,
        uint256 mint2ndAmount,
        uint256[10] memory txsAmount,
        bool[10] memory swapForAgEUR
    ) public {
        mintAmount = bound(mintAmount, 1 ether, 10_000_000 ether);
        mint2ndAmount = bound(mint2ndAmount, 1 ether, 10_000_000 ether);

        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = mintAmount;
        data[0] = abi.encode(0);

        uint256 prevlpTokenSupply = mainPool.totalSupply();

        vm.startPrank(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
        vm.stopPrank();

        vm.startPrank(_dylan);
        for (uint256 i = 0; i < txsAmount.length; i++) {
            if (swapForAgEUR[i]) {
                txsAmount[i] = bound(txsAmount[i], 10**6, 1_000_000 * 10**6);
                deal(address(collateral), address(_dylan), txsAmount[i]);
                collateral.approve(address(mainPool), txsAmount[i]);
                mainPool.exchange(1, 0, txsAmount[i], 0);
            } else {
                txsAmount[i] = bound(txsAmount[i], 1 ether, 1_000_000 ether);
                deal(address(agToken), address(_dylan), txsAmount[i]);
                agToken.approve(address(mainPool), txsAmount[i]);
                mainPool.exchange(0, 1, txsAmount[i], 0);
            }
        }
        vm.stopPrank();

        uint256 netAgToken = _getNavBPAMO();
        amounts[0] = mint2ndAmount;
        vm.startPrank(_GOVERNOR);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
        vm.stopPrank();

        assertEq(amo.lastBalances(IERC20(address(agToken))), mint2ndAmount + netAgToken);
        if (netAgToken > mintAmount) {
            assertEq(amo.protocolDebts(IERC20(address(agToken))), 0);
            assertEq(amo.protocolGains(IERC20(address(agToken))), netAgToken - mintAmount);
        } else {
            assertEq(amo.protocolDebts(IERC20(address(agToken))), mintAmount - netAgToken);
            assertEq(amo.protocolGains(IERC20(address(agToken))), 0);
        }

        assertEq(mainPool.balanceOf(address(amo)), 0);
        assertEq(mainPool.balanceOf(address(amoMinter)), 0);
        assertEq(mainPool.balanceOf(address(_GOVERNOR)), 0);
        assertEq(_liquidityGauge.balanceOf(address(amo)), mainPool.totalSupply() - prevlpTokenSupply);
    }

    function testMultiPushGainDebtsMultiTx(
        uint256[5] memory mintAmounts,
        uint256[5] memory txsAmount,
        uint256[10] memory swapForAgEUR
    ) public {
        vm.startPrank(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        vm.stopPrank();

        uint256 prevlpTokenSupply = mainPool.totalSupply();
        uint256 idxAdd = 0;
        uint256 idxSwap = 0;
        uint256 prevLastBalance = 0;
        uint256 prevGains = 0;
        uint256 prevDebts = 0;
        for (uint256 i = 0; i < txsAmount.length; i++) {
            if (idxAdd < 10 && idxSwap < 10) swapForAgEUR[i] = bound(swapForAgEUR[i], 0, 2);
            else if (idxAdd < 10) swapForAgEUR[i] = bound(swapForAgEUR[i], 1, 2);
            else swapForAgEUR[i] = 0;
            if (swapForAgEUR[i] == 0) {
                mintAmounts[idxAdd] = bound(mintAmounts[idxAdd], 1 ether, 5_000_000 ether);
                uint256 netAgToken = idxAdd == 0 ? 0 : _getNavBPAMO();

                {
                    IERC20[] memory tokens = new IERC20[](1);
                    bool[] memory isStablecoin = new bool[](1);
                    uint256[] memory amounts = new uint256[](1);
                    bytes[] memory data = new bytes[](1);

                    tokens[0] = IERC20(address(agToken));
                    isStablecoin[0] = true;
                    data[0] = abi.encode(0);
                    amounts[0] = mintAmounts[idxAdd];

                    vm.startPrank(_GOVERNOR);
                    amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
                    vm.stopPrank();
                }

                assertEq(amo.lastBalances(IERC20(address(agToken))), mintAmounts[idxAdd] + netAgToken);

                if (netAgToken > prevLastBalance) {
                    uint256 gain = netAgToken - prevLastBalance;
                    if (prevDebts <= gain) {
                        prevGains += gain - prevDebts;
                        prevDebts = 0;
                    } else prevDebts -= gain;
                } else {
                    uint256 loss = prevLastBalance - netAgToken;
                    if (loss > prevGains) {
                        prevDebts += loss - prevGains;
                        prevGains = 0;
                    } else prevGains -= loss;
                }

                assertApproxEqAbs(amo.protocolDebts(IERC20(address(agToken))), prevDebts, 10 wei);
                assertApproxEqAbs(amo.protocolGains(IERC20(address(agToken))), prevGains, 10 wei);

                prevLastBalance = mintAmounts[idxAdd] + netAgToken;

                idxAdd += 1;
            }
            if (swapForAgEUR[i] == 1) {
                vm.startPrank(_dylan);
                txsAmount[idxSwap] = bound(txsAmount[idxSwap], 10**6, 1_000_000 * 10**6);
                deal(address(collateral), address(_dylan), txsAmount[idxSwap]);
                collateral.approve(address(mainPool), txsAmount[idxSwap]);
                mainPool.exchange(1, 0, txsAmount[idxSwap], 0);
                vm.stopPrank();
                idxSwap += 1;
            } else {
                vm.startPrank(_dylan);
                txsAmount[idxSwap] = bound(txsAmount[idxSwap], 1 ether, 1_000_000 ether);
                deal(address(agToken), address(_dylan), txsAmount[idxSwap]);
                agToken.approve(address(mainPool), txsAmount[idxSwap]);
                mainPool.exchange(0, 1, txsAmount[idxSwap], 0);
                vm.stopPrank();
                idxSwap += 1;
            }
        }

        assertEq(mainPool.balanceOf(address(amo)), 0);
        assertEq(mainPool.balanceOf(address(amoMinter)), 0);
        assertEq(mainPool.balanceOf(address(_GOVERNOR)), 0);
        assertEq(_liquidityGauge.balanceOf(address(amo)), mainPool.totalSupply() - prevlpTokenSupply);
    }

    // ==================================== PULL ===================================

    function testPushRevertWithdrawalFee(
        uint256 mintAmount,
        uint256 propWithdrawAmount,
        uint256 withdrawalFee
    ) public {
        mintAmount = bound(mintAmount, 1 ether, 10_000_000 ether);
        propWithdrawAmount = bound(propWithdrawAmount, 1, 50 * 10**7);
        withdrawalFee = bound(withdrawalFee, 1, 10000);

        vm.prank(SDTGovernance);
        IStakeCurveVault(_stakeDAOVault).setWithdrawnFee(withdrawalFee);

        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = mintAmount;
        data[0] = abi.encode(0);

        startHoax(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);

        propWithdrawAmount = (mintAmount * propWithdrawAmount) / 10**9;
        amounts[0] = propWithdrawAmount;
        data[0] = abi.encode(type(uint256).max);
        vm.expectRevert(StakeBPAMO.WithdrawFeeTooLarge.selector);
        amoMinter.receiveFromAMO(amo, tokens, isStablecoin, amounts, new address[](1), data);
    }

    function testFailPullTooLargeAmount(uint256 mintAmount) public {
        mintAmount = bound(mintAmount, 1 ether, 10_000_000 ether);
        uint256 withdrawAmount = mintAmount + 1;

        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = mintAmount;
        data[0] = abi.encode(0);

        startHoax(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);

        // withdraw directly, as there is no action there shouldn't be any gain and therefore we try to withdraw too much
        amounts[0] = withdrawAmount;
        data[0] = abi.encode(type(uint256).max);

        // it will revert in the lastBalances update
        amoMinter.receiveFromAMO(amo, tokens, isStablecoin, amounts, new address[](1), data);
    }

    function testPullSimple(uint256 mintAmount, uint256 propWithdrawAmount) public {
        mintAmount = bound(mintAmount, 1 ether, 10_000_000 ether);
        propWithdrawAmount = bound(propWithdrawAmount, 1, 90 * 10**7);

        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = mintAmount;
        data[0] = abi.encode(0);

        uint256 prevAgTokenBalanceCurve = agToken.balanceOf(address(mainPool));
        uint256 prevCollateralBalanceCurve = collateral.balanceOf(address(mainPool));
        uint256 prevlpTokenSupply = mainPool.totalSupply();
        uint256 prevGovAgEURBalance = agToken.balanceOf(_GOVERNOR);

        startHoax(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);

        propWithdrawAmount = (mintAmount * propWithdrawAmount) / 10**9;
        amounts[0] = propWithdrawAmount;
        data[0] = abi.encode(type(uint256).max);
        amoMinter.receiveFromAMO(amo, tokens, isStablecoin, amounts, new address[](1), data);

        // possibly a fee, on the add_liquidity
        assertApproxEqAbs(
            amo.lastBalances(IERC20(address(agToken))),
            mintAmount - propWithdrawAmount,
            (mintAmount * 3 * fee) / 10**9
        );
        assertEq(
            amo.protocolDebts(IERC20(address(agToken))),
            mintAmount - propWithdrawAmount - amo.lastBalances(IERC20(address(agToken)))
        );
        assertEq(amo.protocolGains(IERC20(address(agToken))), 0);

        assertGe(agToken.balanceOf(address(mainPool)), prevAgTokenBalanceCurve + mintAmount - propWithdrawAmount);
        assertEq(collateral.balanceOf(address(mainPool)), prevCollateralBalanceCurve);
        assertEq(agToken.balanceOf(_GOVERNOR), prevGovAgEURBalance);
        assertEq(collateral.balanceOf(_GOVERNOR), 0);

        assertEq(mainPool.balanceOf(address(amo)), 0);
        assertEq(mainPool.balanceOf(address(amoMinter)), 0);
        assertEq(mainPool.balanceOf(address(_GOVERNOR)), 0);
        assertEq(_liquidityGauge.balanceOf(address(amo)), mainPool.totalSupply() - prevlpTokenSupply);
    }

    function testMultiPullGainDebtsMultiTx(
        uint256[5] memory liquidityAmounts,
        uint256[5] memory txsAmount,
        uint256[10] memory swapForAgEUR
    ) public {
        vm.startPrank(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        vm.stopPrank();

        uint256 prevlpTokenSupply = mainPool.totalSupply();
        uint256 idxLiquidity = 0;
        uint256 idxSwap = 0;
        uint256 prevLastBalance = 0;
        uint256 prevGains = 0;
        uint256 prevDebts = 0;
        for (uint256 i = 0; i < txsAmount.length; i++) {
            if (idxLiquidity < 10 && idxSwap < 10) swapForAgEUR[i] = bound(swapForAgEUR[i], 0, 3);
            else if (idxLiquidity < 10) swapForAgEUR[i] = bound(swapForAgEUR[i], 2, 3);
            else swapForAgEUR[i] = bound(swapForAgEUR[i], 0, 1);
            if (swapForAgEUR[i] == 0) {
                liquidityAmounts[idxLiquidity] = bound(liquidityAmounts[idxLiquidity], 1 ether, 5_000_000 ether);
                uint256 netAgToken = idxLiquidity == 0 ? 0 : _getNavBPAMO();

                {
                    IERC20[] memory tokens = new IERC20[](1);
                    bool[] memory isStablecoin = new bool[](1);
                    uint256[] memory amounts = new uint256[](1);
                    bytes[] memory data = new bytes[](1);

                    tokens[0] = IERC20(address(agToken));
                    isStablecoin[0] = true;
                    data[0] = abi.encode(0);
                    amounts[0] = liquidityAmounts[idxLiquidity];

                    vm.startPrank(_GOVERNOR);
                    amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
                    vm.stopPrank();
                }

                assertEq(amo.lastBalances(IERC20(address(agToken))), liquidityAmounts[idxLiquidity] + netAgToken);

                if (netAgToken > prevLastBalance) {
                    uint256 gain = netAgToken - prevLastBalance;
                    if (prevDebts <= gain) {
                        prevGains += gain - prevDebts;
                        prevDebts = 0;
                    } else prevDebts -= gain;
                } else {
                    uint256 loss = prevLastBalance - netAgToken;
                    if (loss > prevGains) {
                        prevDebts += loss - prevGains;
                        prevGains = 0;
                    } else prevGains -= loss;
                }

                assertApproxEqAbs(amo.protocolDebts(IERC20(address(agToken))), prevDebts, 10 wei);
                assertApproxEqAbs(amo.protocolGains(IERC20(address(agToken))), prevGains, 10 wei);

                prevLastBalance = liquidityAmounts[idxLiquidity] + netAgToken;

                idxLiquidity += 1;
            }
            if (swapForAgEUR[i] == 1) {
                uint256 netAgToken = idxLiquidity == 0 ? 0 : _getNavBPAMO();

                // only burn up to 75% of what we are supposed to own, because it doesn't take into account fees
                // In this case we may be in loss because we don't only do operation to rebalance the pool
                // but do instead chaotic addition/removal of liquidity
                liquidityAmounts[idxLiquidity] = bound(liquidityAmounts[idxLiquidity], 10**3, 75 * 10**7);
                // the maximum of `agXXX` withdrawable is not `_getNavBPAMO`but to the `calc_withdraw_one_coin`
                // uint256 maxWithdrawable = ;
                liquidityAmounts[idxLiquidity] = idxLiquidity == 0
                    ? 0
                    : (liquidityAmounts[idxLiquidity] *
                        mainPool.calc_withdraw_one_coin(_liquidityGauge.balanceOf(address(amo)), STABLE_IDX)) / 10**9;
                {
                    uint256 maxDebtToReimburse = amoMinter.amoDebts(IAMO(address(amo)), IERC20(address(agToken)));
                    if (liquidityAmounts[idxLiquidity] > maxDebtToReimburse)
                        liquidityAmounts[idxLiquidity] = maxDebtToReimburse;
                }
                // otherwise it reverts in Curve contracts as the burtn amount of tokens is null
                vm.assume(liquidityAmounts[idxLiquidity] > 0);
                {
                    IERC20[] memory tokens = new IERC20[](1);
                    bool[] memory isStablecoin = new bool[](1);
                    uint256[] memory amounts = new uint256[](1);
                    address[] memory to = new address[](1);
                    bytes[] memory data = new bytes[](1);

                    tokens[0] = IERC20(address(agToken));
                    isStablecoin[0] = true;
                    data[0] = abi.encode(type(uint256).max);
                    amounts[0] = liquidityAmounts[idxLiquidity];

                    vm.startPrank(_GOVERNOR);
                    amoMinter.receiveFromAMO(amo, tokens, isStablecoin, amounts, to, data);
                    vm.stopPrank();
                }

                assertEq(amo.lastBalances(IERC20(address(agToken))), netAgToken - liquidityAmounts[idxLiquidity]);

                if (netAgToken > prevLastBalance) {
                    uint256 gain = netAgToken - prevLastBalance;
                    if (prevDebts <= gain) {
                        prevGains += gain - prevDebts;
                        prevDebts = 0;
                    } else prevDebts -= gain;
                } else {
                    uint256 loss = prevLastBalance - netAgToken;
                    if (loss > prevGains) {
                        prevDebts += loss - prevGains;
                        prevGains = 0;
                    } else prevGains -= loss;
                }

                assertApproxEqAbs(amo.protocolDebts(IERC20(address(agToken))), prevDebts, 10 wei);
                assertApproxEqAbs(amo.protocolGains(IERC20(address(agToken))), prevGains, 10 wei);

                prevLastBalance = netAgToken - liquidityAmounts[idxLiquidity];

                idxLiquidity += 1;
            } else if (swapForAgEUR[i] == 2) {
                vm.startPrank(_dylan);
                txsAmount[idxSwap] = bound(txsAmount[idxSwap], 10**6, 1_000_000 * 10**6);
                deal(address(collateral), address(_dylan), txsAmount[idxSwap]);
                collateral.approve(address(mainPool), txsAmount[idxSwap]);
                mainPool.exchange(1, 0, txsAmount[idxSwap], 0);
                vm.stopPrank();
                idxSwap += 1;
            } else {
                vm.startPrank(_dylan);
                txsAmount[idxSwap] = bound(txsAmount[idxSwap], 1 ether, 1_000_000 ether);
                deal(address(agToken), address(_dylan), txsAmount[idxSwap]);
                agToken.approve(address(mainPool), txsAmount[idxSwap]);
                mainPool.exchange(0, 1, txsAmount[idxSwap], 0);
                vm.stopPrank();
                idxSwap += 1;
            }
        }

        assertEq(mainPool.balanceOf(address(amo)), 0);
        assertEq(mainPool.balanceOf(address(amoMinter)), 0);
        assertEq(mainPool.balanceOf(address(_GOVERNOR)), 0);
        assertEq(_liquidityGauge.balanceOf(address(amo)), mainPool.totalSupply() - prevlpTokenSupply);
    }

    // =========================== GETNAVOFINVESTEDASSETS ==========================

    function testGetNavOfInvestedAssets(
        uint256 mintAmount,
        uint256[2] memory txsAmount,
        bool[2] memory swapForAgEUR
    ) public {
        mintAmount = bound(mintAmount, 1 ether, 1_000_000_000 ether);

        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = mintAmount;
        data[0] = abi.encode(0);

        vm.startPrank(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
        vm.stopPrank();

        vm.startPrank(_dylan);
        for (uint256 i = 0; i < txsAmount.length; i++) {
            if (swapForAgEUR[i]) {
                txsAmount[i] = bound(txsAmount[i], 10**6, 1_000_000 * 10**6);
                deal(address(collateral), address(_dylan), txsAmount[i]);
                collateral.approve(address(mainPool), txsAmount[i]);
                mainPool.exchange(1, 0, txsAmount[i], 0);
            } else {
                txsAmount[i] = bound(txsAmount[i], 1 ether, 1_000_000 ether);
                deal(address(agToken), address(_dylan), txsAmount[i]);
                agToken.approve(address(mainPool), txsAmount[i]);
                mainPool.exchange(0, 1, txsAmount[i], 0);
            }
        }
        vm.stopPrank();

        uint256 netAgToken = _getNavBPAMO();
        uint256 nav = amo.getNavOfInvestedAssets(IERC20(address(agToken)));

        assertEq(nav, netAgToken);
    }

    // ================================ CLAIMREWARDS ===============================

    function testClaimRewards(
        uint256 mintAmount,
        uint256 SDTRewardAmount,
        uint256 CRVRewardAmount
    ) public {
        mintAmount = bound(mintAmount, 1 ether, 10_000_000 ether);
        SDTRewardAmount = bound(SDTRewardAmount, 1 ether, 10_000_000 ether);
        CRVRewardAmount = bound(CRVRewardAmount, 1 ether, 10_000_000 ether);

        deal(address(SDT), address(sdtDistributor), SDTRewardAmount);
        deal(address(CRV), address(curveStrategy), CRVRewardAmount);
        // fake a non null incentives program
        vm.startPrank(address(sdtDistributor));
        SDT.approve(address(_liquidityGauge), SDTRewardAmount);
        _liquidityGauge.deposit_reward_token(address(SDT), SDTRewardAmount);
        vm.stopPrank();
        vm.startPrank(address(curveStrategy));
        CRV.approve(address(_liquidityGauge), CRVRewardAmount);
        _liquidityGauge.deposit_reward_token(address(CRV), CRVRewardAmount);
        vm.stopPrank();

        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = mintAmount;
        data[0] = abi.encode(0);

        startHoax(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);

        uint256 totSupply = _liquidityGauge.totalSupply();
        uint256 mySupply = _liquidityGauge.balanceOf(address(amo));

        vm.warp(block.timestamp + 7 * 3600 * 24);
        amo.claimRewards(new IERC20[](0));
        assertApproxEqAbs(CRV.balanceOf(address(amo)), (CRVRewardAmount * mySupply) / totSupply, 10**9);
        assertApproxEqAbs(SDT.balanceOf(address(amo)), (SDTRewardAmount * mySupply) / totSupply, 10**9);
    }

    // // ================================== HELPERS ==================================

    function _getNavBPAMO() public view returns (uint256 nav) {
        uint256 amoLpTokenSupply = _liquidityGauge.balanceOf(address(amo));
        uint256[2] memory balances = IMetaPool2(address(mainPool)).get_balances();
        nav =
            (balances[0] * amoLpTokenSupply) /
            mainPool.totalSupply() +
            ((balances[1] * amoLpTokenSupply) / mainPool.totalSupply()) *
            decimalNormalizer;
    }
}
