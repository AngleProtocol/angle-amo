// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC20MetadataUpgradeable.sol";

import "../BaseTest.t.sol";
import "../../../contracts/amoMinter/AMOMinter.sol";
import "../../../contracts/AMOs/implementations/convex/BPAMOs/ConvexAgEURvEUROCAMO.sol";
import "../../../contracts/keeperJobs/curve/BPAMOJob.sol";
import "../../../contracts/interfaces/external/curve/IMetaPool2.sol";
import "../../../contracts/interfaces/ITreasury.sol";
import "../../../contracts/mock/MockConvexBaseRewardPool.sol";
import "../../../contracts/mock/MockMetaPool.sol";
import "../../../contracts/mock/MockTokenPermit.sol";

contract CurveBPAMOJobTest is BaseTest {
    using stdStorage for StdStorage;

    int128 public constant STABLE_IDX = 0;
    uint256 public constant decimalNormalizer = 10**12;
    IConvexBooster public constant convexBooster = IConvexBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IConvexClaimZap public constant convexClaimZapAddress = IConvexClaimZap(0xDd49A93FDcae579AE50B4b9923325e9e335ec82B);
    ITreasury public constant treasury = ITreasury(0x8667DBEBf68B0BFa6Db54f550f41Be16c4067d60);
    IERC20 public constant CRV = IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);
    IERC20 public constant CVX = IERC20(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);

    // Can be changed depending on the pools to be tested
    IAgToken public agToken = IAgToken(0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8);
    IERC20 public collateral = IERC20(0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c);
    IMetaPool2 public mainPool = IMetaPool2(0xBa3436Fd341F2C8A928452Db3C5A3670d1d5Cc73);
    IConvexBaseRewardPool public baseReward = IConvexBaseRewardPool(0xA91fccC1ec9d4A2271B7A86a7509Ca05057C1A98);
    uint256 public pidConvex = 113;
    uint8 public decimalEUROC = 6;
    uint256 public fee = 4 * 10**5;

    uint256 private _ethereum;

    AMOMinter public amoMinter;
    BPAMOJob public keeperJob;
    ConvexAgEURvEUROCAMO public amo;

    ConvexAgEURvEUROCAMO public amoImplementation;
    AMOMinter public amoMinterImplementation;
    BPAMOJob public keeperJobImplementation;

    function setUp() public override {
        _ethereum = vm.createFork(vm.envString("ETH_NODE_URI_MAINNET"), 15527925);
        vm.selectFork(_ethereum);

        super.setUp();

        amoMinterImplementation = new AMOMinter();
        amoMinter = AMOMinter(
            deployUpgradeable(
                address(amoMinterImplementation),
                abi.encodeWithSelector(amoMinterImplementation.initialize.selector, coreBorrow)
            )
        );
        amoImplementation = new ConvexAgEURvEUROCAMO();
        amo = ConvexAgEURvEUROCAMO(
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
        amoMinter.toggleCallerToAMO(IAMO(address(amo)), address(keeperJob));
        keeperJob.toggleWhitelist(_GOVERNOR);
        vm.stopPrank();
    }

    // ================================= INITIALIZE ================================

    function testInitalizeZeroAddress() public {
        vm.expectRevert(BaseAMOStorage.ZeroAddress.selector);
        keeperJob = BPAMOJob(
            deployUpgradeable(
                address(keeperJobImplementation),
                abi.encodeWithSelector(keeperJobImplementation.initialize.selector, address(0), 0)
            )
        );
    }

    // ================================ CURRENTSTATE ===============================
    function testFailCurrentState() public view {
        keeperJob.currentState(ICurveBPAMO(address(amoMinter)));
    }

    function testCurrentStateNoMint() public {
        uint256[2] memory balances = IMetaPool2(address(mainPool)).get_balances();

        (bool addLiquidity, uint256 delta) = keeperJob.currentState(ICurveBPAMO(address(amo)));
        assertEq(addLiquidity, false);
        assertEq(delta, 0);

        uint256 toSwap = 3 * (balances[0] / decimalNormalizer - balances[1]);
        deal(address(collateral), address(_dylan), toSwap);
        vm.startPrank(_dylan);
        collateral.approve(address(mainPool), toSwap);
        mainPool.exchange(1, 0, toSwap, 0);
        vm.stopPrank();

        balances = IMetaPool2(address(mainPool)).get_balances();

        (addLiquidity, delta) = keeperJob.currentState(ICurveBPAMO(address(amo)));
        assertEq(addLiquidity, true);
        assertEq(delta, balances[1] * decimalNormalizer - balances[0]);
    }

    function testCurrentStateRemoveNonNull() public {
        uint256[2] memory balances = IMetaPool2(address(mainPool)).get_balances();

        uint256 toSwap = 3 * (balances[0] / decimalNormalizer - balances[1]);
        deal(address(collateral), address(_dylan), toSwap);
        vm.startPrank(_dylan);
        collateral.approve(address(mainPool), toSwap);
        mainPool.exchange(1, 0, toSwap, 0);
        vm.stopPrank();

        balances = IMetaPool2(address(mainPool)).get_balances();

        (bool addLiquidity, uint256 delta) = keeperJob.currentState(ICurveBPAMO(address(amo)));
        assertEq(addLiquidity, true);
        assertEq(delta, balances[1] * decimalNormalizer - balances[0]);

        // make a large mint on the amo
        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        tokens[0] = IERC20(address(agToken));
        isStablecoin[0] = true;
        amounts[0] = 10 * (balances[1] * decimalNormalizer);
        data[0] = abi.encode(0);

        vm.startPrank(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
        vm.stopPrank();

        balances = IMetaPool2(address(mainPool)).get_balances();
        uint256 supposedDelta = balances[0] - balances[1] * decimalNormalizer;
        (addLiquidity, delta) = keeperJob.currentState(ICurveBPAMO(address(amo)));
        assertEq(addLiquidity, false);
        assertEq(delta, supposedDelta);
    }

    // =================================== ADJUST ==================================

    function testAdjust(uint256[4] memory txsAmount, bool[4] memory swapForAgEUR) public {
        uint256[2] memory balances = IMetaPool2(address(mainPool)).get_balances();

        uint256 toSwap = 3 * (balances[0] / decimalNormalizer - balances[1]);
        deal(address(collateral), address(_dylan), toSwap);
        vm.startPrank(_dylan);
        collateral.approve(address(mainPool), toSwap);
        mainPool.exchange(1, 0, toSwap, 0);
        vm.stopPrank();

        for (uint256 i = 0; i < txsAmount.length; i++) {
            // let's see if we can add/remove liquidity
            {
                balances = IMetaPool2(address(mainPool)).get_balances();
                uint256 currentDebt = amoMinter.amoDebts(IAMO(address(amo)), IERC20(address(agToken)));
                bool addLiquidity;
                uint256 delta;
                (, uint256 deltaEstim) = keeperJob.currentState(ICurveBPAMO(address(amo)));
                if (deltaEstim > 1) {
                    vm.prank(_GOVERNOR);
                    (addLiquidity, delta) = keeperJob.adjust(ICurveBPAMO(address(amo)));

                    uint256 newDebt = amoMinter.amoDebts(IAMO(address(amo)), IERC20(address(agToken)));

                    if (balances[0] > balances[1] * decimalNormalizer && currentDebt > 0) {
                        uint256 trueWithdraw = (currentDebt < (balances[0] - balances[1] * decimalNormalizer))
                            ? currentDebt
                            : balances[0] - balances[1] * decimalNormalizer;
                        assertEq(addLiquidity, false);
                        assertEq(delta, trueWithdraw);
                        assertEq(currentDebt, newDebt + trueWithdraw);

                        // we are only sure to be balance only if the debt was large enough to set it back to the desired amount
                        balances = IMetaPool2(address(mainPool)).get_balances();
                        if (trueWithdraw < currentDebt)
                            assertApproxEqAbs(balances[0], balances[1] * decimalNormalizer, balances[0] / 1000);
                    } else if (balances[0] < balances[1] * decimalNormalizer) {
                        assertEq(addLiquidity, true);
                        assertEq(delta, balances[1] * decimalNormalizer - balances[0]);
                        assertEq(currentDebt + balances[1] * decimalNormalizer - balances[0], newDebt);

                        //should be nearly equal (because of fee) everytime
                        balances = IMetaPool2(address(mainPool)).get_balances();
                        assertApproxEqAbs(balances[0], balances[1] * decimalNormalizer, balances[0] / 1000);
                    }
                }
            }

            // then do some operation
            if (swapForAgEUR[i]) {
                vm.startPrank(_dylan);
                txsAmount[i] = bound(txsAmount[i], 10**6, 1_000_000 * 10**6);
                deal(address(collateral), address(_dylan), txsAmount[i]);
                collateral.approve(address(mainPool), txsAmount[i]);
                mainPool.exchange(1, 0, txsAmount[i], 0);
                vm.stopPrank();
            } else {
                vm.startPrank(_dylan);
                txsAmount[i] = bound(txsAmount[i], 1 ether, 1_000_000 ether);
                deal(address(agToken), address(_dylan), txsAmount[i]);
                agToken.approve(address(mainPool), txsAmount[i]);
                mainPool.exchange(0, 1, txsAmount[i], 0);
                vm.stopPrank();
            }
        }

        uint256 debt = amo.protocolDebts(IERC20(address(agToken)));
        uint256 gains = amo.protocolGains(IERC20(address(agToken)));
        uint256 nav = amo.getNavOfInvestedAssets(IERC20(address(agToken)));
        uint256 debtToMinter = amoMinter.amoDebts(IAMO(address(amo)), IERC20(address(agToken)));
        assertGe(gains + nav, debtToMinter + debt);
    }

    // ================================ EXTRA CHECK ================================

    // check on fees when add and we can fully remove liquidity from Curve
    function testFeesCurveFullRecover(uint256[1] memory txsAmount) public {
        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        {
            uint256 curAgTokenCurve = agToken.balanceOf(address(mainPool));
            uint256 curCollatCurve = collateral.balanceOf(address(mainPool));

            if (curAgTokenCurve / decimalNormalizer > curCollatCurve) {
                uint256 toSwap = 3 * (curAgTokenCurve / decimalNormalizer - curCollatCurve);
                deal(address(collateral), address(_dylan), toSwap);
                vm.startPrank(_dylan);
                collateral.approve(address(mainPool), toSwap);
                mainPool.exchange(1, 0, toSwap, 0);
                vm.stopPrank();
            }

            curAgTokenCurve = agToken.balanceOf(address(mainPool));
            curCollatCurve = collateral.balanceOf(address(mainPool));

            assertGt(curCollatCurve, curAgTokenCurve / decimalNormalizer);

            tokens[0] = IERC20(address(agToken));
            isStablecoin[0] = true;
            amounts[0] = curCollatCurve * decimalNormalizer - curAgTokenCurve;
            data[0] = abi.encode(0);
        }

        vm.startPrank(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
        vm.stopPrank();

        uint256 nav = amo.getNavOfInvestedAssets(IERC20(address(agToken)));
        // the bonus to add liquidity should be better than the fees paid
        assertGe(nav, amounts[0]);

        vm.startPrank(_dylan);
        for (uint256 i = 0; i < txsAmount.length; i++) {
            uint256 currentDebt = amoMinter.amoDebts(IAMO(address(amo)), IERC20(address(agToken)));
            // to let us at least withdraw the debt to reimburse fully the AMOMinter
            txsAmount[i] = bound(txsAmount[i], currentDebt, 1_000_000 ether);
            deal(address(agToken), address(_dylan), txsAmount[i]);
            agToken.approve(address(mainPool), txsAmount[i]);
            mainPool.exchange(0, 1, txsAmount[i], 0);
        }
        vm.stopPrank();

        {
            uint256 curAgTokenCurve = agToken.balanceOf(address(mainPool));
            uint256 curCollatCurve = collateral.balanceOf(address(mainPool));

            assertGt(curAgTokenCurve / decimalNormalizer, curCollatCurve);
            data[0] = abi.encode(type(uint256).max);
            // we don't want to withdraw more than what has been lent
            amounts[0] = (amounts[0] < curAgTokenCurve - curCollatCurve * decimalNormalizer)
                ? amounts[0]
                : curAgTokenCurve - curCollatCurve * decimalNormalizer;
        }

        vm.startPrank(_GOVERNOR);
        amoMinter.receiveFromAMO(amo, tokens, isStablecoin, amounts, new address[](1), data);
        vm.stopPrank();

        uint256 debt = amo.protocolDebts(IERC20(address(agToken)));
        uint256 gains = amo.protocolGains(IERC20(address(agToken)));
        nav = amo.getNavOfInvestedAssets(IERC20(address(agToken)));
        uint256 debtToMinter = amoMinter.amoDebts(IAMO(address(amo)), IERC20(address(agToken)));

        assertEq(debtToMinter, 0);
        assertGe(gains + nav, debtToMinter + debt);
    }

    // check on fees when add and we can fully remove liquidity from Curve
    function testFeesCurveNoFullRecover(uint256[10] memory txsAmount, bool[10] memory swapForAgEUR) public {
        IERC20[] memory tokens = new IERC20[](1);
        bool[] memory isStablecoin = new bool[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        {
            uint256 curAgTokenCurve = agToken.balanceOf(address(mainPool));
            uint256 curCollatCurve = collateral.balanceOf(address(mainPool));

            if (curAgTokenCurve / decimalNormalizer > curCollatCurve) {
                uint256 toSwap = (7 * (curAgTokenCurve / decimalNormalizer - curCollatCurve)) / 2;
                deal(address(collateral), address(_dylan), toSwap);
                vm.startPrank(_dylan);
                collateral.approve(address(mainPool), toSwap);
                mainPool.exchange(1, 0, toSwap, 0);
                vm.stopPrank();
            }

            curAgTokenCurve = agToken.balanceOf(address(mainPool));
            curCollatCurve = collateral.balanceOf(address(mainPool));

            tokens[0] = IERC20(address(agToken));
            isStablecoin[0] = true;
            amounts[0] = curCollatCurve * decimalNormalizer - curAgTokenCurve;
            data[0] = abi.encode(0);
        }

        vm.startPrank(_GOVERNOR);
        amoMinter.addTokenRightToAMO(IAMO(address(amo)), IERC20(address(collateral)), type(uint256).max);
        amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
        vm.stopPrank();

        for (uint256 i = 0; i < txsAmount.length; i++) {
            if (swapForAgEUR[i]) {
                vm.startPrank(_dylan);
                txsAmount[i] = bound(txsAmount[i], 5000 * 10**6, 1_000_000 * 10**6);
                deal(address(collateral), address(_dylan), txsAmount[i]);
                collateral.approve(address(mainPool), txsAmount[i]);
                mainPool.exchange(1, 0, txsAmount[i], 0);
                vm.stopPrank();
            } else {
                vm.startPrank(_dylan);
                txsAmount[i] = bound(txsAmount[i], 5000 * 1 ether, 1_000_000 ether);
                deal(address(agToken), address(_dylan), txsAmount[i]);
                agToken.approve(address(mainPool), txsAmount[i]);
                mainPool.exchange(0, 1, txsAmount[i], 0);
                vm.stopPrank();
            }

            // let's see if we can add/remove liquidity
            uint256 curAgTokenCurve = agToken.balanceOf(address(mainPool));
            uint256 curCollatCurve = collateral.balanceOf(address(mainPool));
            uint256 currentDebt = amoMinter.amoDebts(IAMO(address(amo)), IERC20(address(agToken)));

            if (curAgTokenCurve > curCollatCurve * decimalNormalizer && currentDebt > 0) {
                data[0] = abi.encode(type(uint256).max);
                // we don't want to withdraw more than what has been lent
                amounts[0] = (currentDebt < curAgTokenCurve - curCollatCurve * decimalNormalizer)
                    ? currentDebt
                    : curAgTokenCurve - curCollatCurve * decimalNormalizer;
                vm.startPrank(_GOVERNOR);
                amoMinter.receiveFromAMO(amo, tokens, isStablecoin, amounts, new address[](1), data);
                vm.stopPrank();
            } else if (curAgTokenCurve < curCollatCurve * decimalNormalizer) {
                data[0] = abi.encode(0);
                // we don't want to withdraw more than what has been lent
                amounts[0] = curCollatCurve * decimalNormalizer - curAgTokenCurve;
                vm.startPrank(_GOVERNOR);
                amoMinter.sendToAMO(amo, tokens, isStablecoin, amounts, data);
                vm.stopPrank();
            }
        }

        uint256 debt = amo.protocolDebts(IERC20(address(agToken)));
        uint256 gains = amo.protocolGains(IERC20(address(agToken)));
        uint256 nav = amo.getNavOfInvestedAssets(IERC20(address(agToken)));
        uint256 debtToMinter = amoMinter.amoDebts(IAMO(address(amo)), IERC20(address(agToken)));
        assertGe(gains + nav, debtToMinter + debt);
    }
}
