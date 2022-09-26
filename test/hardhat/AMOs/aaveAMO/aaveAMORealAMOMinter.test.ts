import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers, network } from 'hardhat';

import {
  AaveAMO,
  AaveAMO__factory,
  AMOMinter,
  AMOMinter__factory,
  ERC20,
  ERC20__factory,
  MockCoreBorrow,
  MockCoreBorrow__factory,
} from '../../../../typechain';
import { expect } from '../../utils/chai-setup';
import { inReceipt } from '../../utils/expectEvent';
import { deploy, deployUpgradeable, expectApprox, increaseTime, MAX_UINT256, ZERO_ADDRESS } from '../../utils/helpers';

contract('AaveAMO - Plugged to the real AMOMinter contract', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  let amo: AaveAMO;
  let usdc: ERC20;
  let dai: ERC20;
  let aToken: ERC20;
  let debtToken: ERC20;
  let aTokenDAI: ERC20;

  let amoMinter: AMOMinter;
  let governor: string;
  let guardian: string;
  let usdcHolder: string;
  let daiHolder: string;
  let lendingPool: string;
  let coreBorrow: MockCoreBorrow;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob, proxyAdmin] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
    guardian = '0x0C2553e4B9dFA9f83b1A6D3EAB96c4bAaB42d430';
    usdcHolder = '0xCFFAd3200574698b78f32232aa9D63eABD290703';
    daiHolder = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
    usdc = (await ethers.getContractAt(ERC20__factory.abi, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')) as ERC20;
    dai = (await ethers.getContractAt(ERC20__factory.abi, '0x6B175474E89094C44Da98b954EedeAC495271d0F')) as ERC20;
    aToken = (await ethers.getContractAt(ERC20__factory.abi, '0xBcca60bB61934080951369a648Fb03DF4F96263C')) as ERC20;
    debtToken = (await ethers.getContractAt(ERC20__factory.abi, '0x619beb58998eD2278e08620f97007e1116D5D25b')) as ERC20;

    aTokenDAI = (await ethers.getContractAt(ERC20__factory.abi, '0x028171bCA77440897B824Ca71D1c56caC55b68A3')) as ERC20;

    lendingPool = '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9';
  });

  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            blockNumber: 14703866,
          },
        },
      ],
    });
    governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
    guardian = '0x0C2553e4B9dFA9f83b1A6D3EAB96c4bAaB42d430';
    const impersonatedAddresses = [governor, guardian];
    for (const address of impersonatedAddresses) {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [address],
      });
      await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
      impersonatedSigners[address] = await ethers.getSigner(address);
    }
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    await coreBorrow.toggleGovernor(governor);
    await coreBorrow.toggleGuardian(guardian);
    const amoImplementation = (await deploy('AaveAMO')) as AaveAMO;
    const proxy = await deploy('TransparentUpgradeableProxy', [amoImplementation.address, proxyAdmin.address, '0x']);
    amo = new Contract(proxy.address, AaveAMO__factory.createInterface(), deployer) as AaveAMO;
    amoMinter = (await deployUpgradeable(new AMOMinter__factory(deployer))) as AMOMinter;
    await amoMinter.initialize(coreBorrow.address);
    await amo.initialize(amoMinter.address);
    await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
  });
  describe('setToken - addTokenRightToAMO', () => {
    it('success - token correctly added', async () => {
      // First checking if the operation to add the AMO has correctly been done
      expect(await amoMinter.amosWhitelist(amo.address)).to.be.equal(1);
      expect(await amoMinter.amoList(0)).to.be.equal(amo.address);
      expect(await amo.amoMinter()).to.be.equal(amoMinter.address);
      const amoList = await amoMinter.allAMOAddresses();
      expect(amoList[0]).to.be.equal(amo.address);
      const receipt = await (
        await amoMinter
          .connect(impersonatedSigners[governor])
          .addTokenRightToAMO(amo.address, usdc.address, parseUnits('1', 9))
      ).wait();
      // AMOMinter checks
      inReceipt(receipt, 'AMORightOnTokenAdded', {
        amo: amo.address,
        token: usdc.address,
      });
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: usdc.address,
        borrowCap: parseUnits('1', 9),
      });
      expect(await amoMinter.amosWhitelistToken(amo.address, usdc.address)).to.be.equal(1);
      expect(await amoMinter.amoTokens(amo.address, 0)).to.be.equal(usdc.address);
      expect(await amoMinter.borrowCaps(amo.address, usdc.address)).to.be.equal(parseUnits('1', 9));
      const amoTokensList = await amoMinter.allAMOTokens(amo.address);
      expect(amoTokensList[0]).to.be.equal(usdc.address);
      // AMO contract checks
      expect((await amo.tokensParams(usdc.address)).liquidationThreshold).to.be.equal(parseEther('0.86'));
      expect((await amo.tokensParams(usdc.address)).aToken).to.be.equal(aToken.address);
      expect((await amo.tokensParams(usdc.address)).debtToken).to.be.equal(debtToken.address);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(MAX_UINT256);
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await amo.activeTokenList(0)).to.be.equal(usdc.address);
      expect(await amo.debt(usdc.address)).to.be.equal(0);
    });
  });
  describe('removeToken - removeTokenRightFromAMO', () => {
    it('success - token correctly removed', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, usdc.address, parseUnits('1', 9));
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, usdc.address)
      ).wait();
      inReceipt(receipt, 'AMORightOnTokenRemoved', {
        amo: amo.address,
        token: usdc.address,
      });
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: usdc.address,
        borrowCap: 0,
      });
      // AMOMinter checks
      expect(await amoMinter.amosWhitelistToken(amo.address, usdc.address)).to.be.equal(0);
      expect(await amoMinter.borrowCaps(amo.address, usdc.address)).to.be.equal(parseUnits('0', 9));
      const amoTokensList = await amoMinter.allAMOTokens(amo.address);
      expect(amoTokensList.length).to.be.equal(0);
      await expect(amoMinter.amoTokens(amo.address, 0)).to.be.reverted;
      // AMO Contract checks
      expect((await amo.tokensParams(usdc.address)).liquidationThreshold).to.be.equal(0);
      expect((await amo.tokensParams(usdc.address)).aToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensParams(usdc.address)).debtToken).to.be.equal(ZERO_ADDRESS);
      expect(await aToken.allowance(amo.address, lendingPool)).to.be.equal(0);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      await expect(amo.activeTokenList(0)).to.be.reverted;
    });
  });
  describe('isApproved - toggleCallerToAMO', () => {
    it('success - caller correctly toggled', async () => {
      // Operation reverts if not approved
      await expect(amo.connect(alice).toggleLiquidationCheck()).to.be.revertedWith('NotApproved');
      await amoMinter.connect(impersonatedSigners[governor]).toggleCallerToAMO(amo.address, alice.address);
      expect(await amoMinter.amosWhitelistCaller(amo.address, alice.address)).to.be.equal(1);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
    });
  });
  describe('push - sendToAMO', () => {
    it('success - one token successfully sent and lent on Aave', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, usdc.address, parseUnits('1', 9));
      // Reverts if AMOMinter does not have the tokens
      await expect(amoMinter.sendToAMO(amo.address, [usdc.address], [false], [parseUnits('1', 8)], [])).to.be.reverted;
      const impersonatedAddresses = [usdcHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amoMinter.address, parseUnits('1', 9));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [usdc.address], [false], [parseUnits('1', 8)], []);
      expect(await amoMinter.amoDebts(amo.address, usdc.address)).to.be.equal(parseUnits('1', 8));
      expect(await usdc.balanceOf(amoMinter.address)).to.be.equal(parseUnits('9', 8));
      expect(await usdc.balanceOf(amo.address)).to.be.equal(parseUnits('0', 8));
      expect(await amo.debt(usdc.address)).to.be.equal(parseUnits('1', 8));
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 8));
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('1', 8));
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256.sub(parseUnits('1', 8)));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(parseUnits('1', 8));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0', 8));
      expect(await amo.protocolDebts(usdc.address)).to.be.equal(parseUnits('0', 8));
    });
    it('success - multiple tokens successfully sent and lent on Aave - DAI and USDC', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, usdc.address, parseUnits('1', 9));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, dai.address, parseEther('1000'));
      const impersonatedAddresses = [usdcHolder, daiHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amoMinter.address, parseUnits('1', 9));
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amoMinter.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amo.address,
          [usdc.address, dai.address],
          [false, false],
          [parseUnits('1', 8), parseEther('100')],
          [],
        );
      expect(await amoMinter.amoDebts(amo.address, usdc.address)).to.be.equal(parseUnits('1', 8));
      expect(await amoMinter.amoDebts(amo.address, dai.address)).to.be.equal(parseEther('100'));
      expect(await usdc.balanceOf(amoMinter.address)).to.be.equal(parseUnits('9', 8));
      expect(await usdc.balanceOf(amo.address)).to.be.equal(parseUnits('0', 8));
      expect(await dai.balanceOf(amoMinter.address)).to.be.equal(parseEther('900'));
      expect(await dai.balanceOf(amo.address)).to.be.equal(0);
      expect(await amo.debt(usdc.address)).to.be.equal(parseUnits('1', 8));
      expect(await amo.debt(dai.address)).to.be.equal(parseEther('100'));
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 8));
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('100'));
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('1', 8));
      expect(await aTokenDAI.balanceOf(amo.address)).to.be.equal(parseEther('100'));
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256.sub(parseUnits('1', 8)));
      expect(await dai.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(parseUnits('1', 8));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0', 8));
      expect(await amo.protocolDebts(usdc.address)).to.be.equal(parseUnits('0', 8));
      expect(await amo.getNavOfInvestedAssets(dai.address)).to.be.equal(parseEther('100'));
      expect(await amo.protocolGains(dai.address)).to.be.equal(0);
      expect(await amo.protocolDebts(dai.address)).to.be.equal(0);
    });
  });
  describe('pull - receiveFromAMO', () => {
    it('success - pull almost all from one token', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, dai.address, parseEther('1000'));
      const impersonatedAddresses = [daiHolder];
      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amoMinter.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [dai.address], [false], [parseEther('100')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(amo.address, [dai.address], [false], [parseEther('100')], [bob.address], []);
      expect(await amoMinter.amoDebts(amo.address, dai.address)).to.be.equal(0);
      expect(await dai.balanceOf(amoMinter.address)).to.be.equal(parseEther('900'));
      expect(await dai.balanceOf(bob.address)).to.be.equal(parseEther('100'));
      expect(await dai.balanceOf(amo.address)).to.be.equal(0);
      // Protocol makes some gains because of lending rates
      expect(await amo.protocolGains(dai.address)).to.be.gt(0);
      expect(await aTokenDAI.balanceOf(amo.address)).to.be.gt(0);
    });
    it('success - pull a portion from one token', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, dai.address, parseEther('1000'));
      const impersonatedAddresses = [daiHolder];
      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amoMinter.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [dai.address], [false], [parseEther('100')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(amo.address, [dai.address], [false], [parseEther('50')], [bob.address], []);
      expect(await amoMinter.amoDebts(amo.address, dai.address)).to.be.equal(parseEther('50'));
      expect(await dai.balanceOf(amoMinter.address)).to.be.equal(parseEther('900'));
      expect(await dai.balanceOf(bob.address)).to.be.equal(parseEther('50'));
      expect(await dai.balanceOf(amo.address)).to.be.equal(0);
      // Protocol makes some gains because of lending rates
      expect(await amo.protocolGains(dai.address)).to.be.gt(0);
      expect(await aTokenDAI.balanceOf(amo.address)).to.be.gt(parseEther('50'));
    });
    it('success - pulled from multiple tokens', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, dai.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, usdc.address, parseUnits('1000', 6));
      const impersonatedAddresses = [daiHolder, usdcHolder];
      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amoMinter.address, parseEther('1000'));
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amoMinter.address, parseUnits('1000', 6));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amo.address,
          [dai.address, usdc.address],
          [false, false],
          [parseEther('100'), parseUnits('100', 6)],
          [],
        );
      await increaseTime(365 * 24 * 3600);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(
          amo.address,
          [dai.address, usdc.address],
          [false, false],
          [parseEther('100'), parseUnits('100', 6)],
          [bob.address, alice.address],
          [],
        );
      expect(await amoMinter.amoDebts(amo.address, dai.address)).to.be.equal(0);
      expect(await amoMinter.amoDebts(amo.address, usdc.address)).to.be.equal(0);
      expect(await dai.balanceOf(amoMinter.address)).to.be.equal(parseEther('900'));
      expect(await dai.balanceOf(bob.address)).to.be.equal(parseEther('100'));
      expect(await usdc.balanceOf(amoMinter.address)).to.be.equal(parseUnits('900', 6));
      expect(await usdc.balanceOf(alice.address)).to.be.equal(parseUnits('100', 6));
      expect(await dai.balanceOf(amo.address)).to.be.equal(0);
      expect(await usdc.balanceOf(amo.address)).to.be.equal(0);
      // Protocol makes some gains because of lending rates
      const aTokenBalance = await aToken.balanceOf(amo.address);
      const aTokenDAIBalance = await aTokenDAI.balanceOf(amo.address);
      // 1.79% APR on USDC at the time of mainnet fork
      // 2.22% APR on DAI
      expectApprox(aTokenBalance, parseUnits('1.794351', 6), 0.1);
      expectApprox(aTokenDAIBalance, parseEther('2.22538'), 0.1);
      expectApprox(await amo.protocolGains(dai.address), aTokenDAIBalance, 0.1);
      expectApprox(await amo.protocolGains(usdc.address), aTokenBalance, 0.1);
    });
  });
});
