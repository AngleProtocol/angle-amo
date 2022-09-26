import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers, network } from 'hardhat';

import {
  AaveAMO,
  AaveAMO__factory,
  ERC20,
  ERC20__factory,
  IStakedAave,
  IStakedAave__factory,
  MockAMOMinter,
  MockAMOMinter__factory,
} from '../../../../typechain';
import { expect } from '../../utils/chai-setup';
import { deploy, expectApprox, increaseTime, latestTime } from '../../utils/helpers';

contract('AaveAMORewards', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  let amo: AaveAMO;
  let usdc: ERC20;
  let dai: ERC20;
  let aave: ERC20;
  let stkAave: IStakedAave;

  let amoMinter: MockAMOMinter;
  let stkAaveHolder: string;
  let daiHolder: string;
  let usdcHolder: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, proxyAdmin] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    usdcHolder = '0xCFFAd3200574698b78f32232aa9D63eABD290703';
    stkAaveHolder = '0x32B61Bb22Cbe4834bc3e73DcE85280037D944a4D';
    daiHolder = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
    usdc = (await ethers.getContractAt(ERC20__factory.abi, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')) as ERC20;
    dai = (await ethers.getContractAt(ERC20__factory.abi, '0x6B175474E89094C44Da98b954EedeAC495271d0F')) as ERC20;
    aave = (await ethers.getContractAt(ERC20__factory.abi, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9')) as ERC20;

    stkAave = (await ethers.getContractAt(
      IStakedAave__factory.abi,
      '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
    )) as IStakedAave;
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
    const amoImplementation = (await deploy('AaveAMO')) as AaveAMO;

    const proxy = await deploy('TransparentUpgradeableProxy', [amoImplementation.address, proxyAdmin.address, '0x']);
    amo = new Contract(proxy.address, AaveAMO__factory.createInterface(), deployer) as AaveAMO;

    amoMinter = (await new MockAMOMinter__factory(deployer).deploy()) as MockAMOMinter;
    await amo.initialize(amoMinter.address);
    await amoMinter.setIsApproved(alice.address, true);
  });

  describe('cooldown', () => {
    it('reverts - when not approved no cooldown balance', async () => {
      await expect(amo.cooldown()).to.be.revertedWith('NotApproved');
      await expect(amo.connect(alice).cooldown()).to.be.revertedWith('INVALID_BALANCE_ON_COOLDOWN');
    });
    it('success - cooldown activated', async () => {
      const impersonatedAddresses = [stkAaveHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(amo.address, parseEther('1'));
      await amo.connect(alice).cooldown();
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
    });
  });
  describe('claimRewards', () => {
    it('success - when nothing to claim', async () => {
      await expect(amo.connect(alice).claimRewards([usdc.address])).to.be.reverted;
      await amoMinter.setToken(amo.address, usdc.address);
      const stkAaveBalance = await stkAave.balanceOf(amo.address);
      await amo.connect(alice).claimRewards([usdc.address]);
      await amoMinter.setToken(amo.address, dai.address);
      await amo.connect(alice).claimRewards([usdc.address, dai.address]);
      expect(await stkAave.balanceOf(amo.address)).to.be.equal(stkAaveBalance);
    });
    it('success - when stkAave balance is not null and check cooldown has not been created', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [stkAaveHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(amo.address, parseEther('1'));
      await amo.connect(alice).claimRewards([usdc.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      // stkAave balance remains unchanged but cooldown must be triggered
      expect(await stkAave.balanceOf(amo.address)).to.be.equal(parseEther('1'));
    });
    it('success - when stkAave balance is not null check cooldown has been created but we are in the meantime', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [stkAaveHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(amo.address, parseEther('1'));
      await amo.connect(alice).claimRewards([usdc.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      await amo.connect(alice).claimRewards([dai.address]);
      // stkAave balance remains unchanged but cooldown must be triggered
      expect(await stkAave.balanceOf(amo.address)).to.be.equal(parseEther('1'));
    });
    it('success - cooldown status is 1', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [stkAaveHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(amo.address, parseEther('1'));
      await amo.connect(alice).claimRewards([usdc.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      await increaseTime(24 * 10 * 3600 + 10);
      await amo.connect(alice).claimRewards([usdc.address]);
      // Rewards have been claimed and redeemed
      expect(await stkAave.balanceOf(amo.address)).to.be.equal(parseEther('0'));
      // Rewards have been gained: it's 0.001 in 10 days so: we get
      expectApprox(await aave.balanceOf(amo.address), parseEther('1.00191'), 0.1);
    });
    it('success - cooldown status should be 1 but unstake window was overriden', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [stkAaveHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(amo.address, parseEther('1'));
      await amo.connect(alice).claimRewards([usdc.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      await amo.connect(alice).claimRewards([usdc.address]);
      await increaseTime(24 * 30 * 3600 + 10);
      await amo.connect(alice).claimRewards([usdc.address]);
      // Rewards have not been claimed because we went over the unstake window
      expect(await stkAave.balanceOf(amo.address)).to.be.equal(parseEther('1'));
      // Cooldown reset
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      // Rewards have been gained: it's 0.001 in 10 days so: we get
    });
    it('success - when rewards to claim because real money invested', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [usdcHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('1', 6)]);
      await increaseTime(24 * 365 * 3600);
      // This operation should just claim and trigger the cooldown
      await amo.connect(alice).claimRewards([usdc.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      // 1 stkAave is 100 USDC approx and yield on stkAave is 0.1%
      expectApprox(await stkAave.balanceOf(amo.address), parseUnits('0.0001008', 16), 0.1);
    });
    it('success - when rewards to claim because real money invested in multiple tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [usdcHolder, daiHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('1'));
      await amoMinter.push(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('1')]);
      await increaseTime(24 * 365 * 3600);
      // This operation should just claim and trigger the cooldown
      await amo.connect(alice).claimRewards([usdc.address, dai.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      // 1 stkAave is 100 USDC approx and yield on stkAave is 0.1%, same for DAI
      expectApprox(await stkAave.balanceOf(amo.address), parseUnits('0.000222009', 16), 0.1);
    });
    it('success - when rewards to claim because real money invested and then changed to Aave', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [usdcHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('1', 6)]);
      await increaseTime(24 * 365 * 3600);
      // This operation should just claim and trigger the cooldown
      await amo.connect(alice).claimRewards([usdc.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      // Nothing much should happen here
      await amo.connect(alice).claimRewards([usdc.address]);
      // 1 stkAave is 100 USDC approx and yield on stkAave is 0.1%
      expectApprox(await stkAave.balanceOf(amo.address), parseUnits('0.0001008', 16), 0.1);
      await increaseTime(24 * 10 * 3600 + 10);
      await amo.connect(alice).claimRewards([usdc.address]);
      expect(await stkAave.balanceOf(amo.address)).to.be.equal(0);
      expectApprox(await aave.balanceOf(amo.address), parseUnits('0.00010108', 16), 0.1);
    });
  });
  describe('sellRewards', () => {
    it('success - when aave rewards obtained from two tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [usdcHolder, daiHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('1'));
      await amoMinter.push(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('1')]);
      await increaseTime(24 * 365 * 3600);
      // This operation should just claim and trigger the cooldown
      await amo.connect(alice).claimRewards([usdc.address, dai.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      // Nothing much should happen here
      await amo.connect(alice).claimRewards([usdc.address, dai.address]);
      // 1 stkAave is 100 USDC approx and yield on stkAave is 0.1%
      expectApprox(await stkAave.balanceOf(amo.address), parseUnits('0.000222009', 16), 0.1);
      await increaseTime(24 * 10 * 3600 + 10);
      await amo.connect(alice).claimRewards([usdc.address, dai.address]);
      expect(await stkAave.balanceOf(amo.address)).to.be.equal(0);
      expectApprox(await aave.balanceOf(amo.address), parseUnits('0.000222434', 16), 0.1);
      expect(await usdc.balanceOf(amo.address)).to.be.equal(0);
      // Payload for swapping 10**(-6) AAVE to USDC
      const payload =
        '0x2e95b6c80000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae9000000000000000000000000000000000000000000000000000000e8d4a510' +
        '00000000000000000000000000000000000000000000000000000000000000007' +
        '200000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000' +
        '00000000000003b6d03409909d09656fce21d1904f662b99382b887a9c5da80000000000000003b6d0340466d82b7d15af812fb6c788d7b15c635fa933499cfee7c08';
      await amo.connect(alice).sellRewards(0, payload);
      expect(await usdc.balanceOf(amo.address)).to.be.gt(0);
      expectApprox(await aave.balanceOf(amo.address), parseUnits('0.000122434', 16), 0.1);
    });
    it('success - when just stkAave rewards have been obtained', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [usdcHolder, daiHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('1'));
      await amoMinter.push(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('1')]);
      await increaseTime(24 * 365 * 3600);
      // This operation should just claim and trigger the cooldown
      await amo.connect(alice).claimRewards([usdc.address, dai.address]);
      expect(await stkAave.stakersCooldowns(amo.address)).to.be.equal(await latestTime());
      expectApprox(await stkAave.balanceOf(amo.address), parseUnits('0.000222009', 16), 0.1);
      expect(await aave.balanceOf(amo.address)).to.be.equal(0);
      // Payload for swapping 10**(-6) stkAAVE to Aave
      const payload =
        '0xe449022e000000000000000000000000000000000000000000000000000000e8d4a51000000000000000000000000000000000000000000000' +
        '000000000000cddddaa43b00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000' +
        '0000000000000000000000000000000010000000000000000000000001a76f6b9b3d9c532e0b56990944a31a705933fbdcfee7c08';
      await amo.connect(alice).sellRewards(0, payload);
      expectApprox(await aave.balanceOf(amo.address), parseUnits('0.00009617679', 16), 0.1);
      expectApprox(await stkAave.balanceOf(amo.address), parseUnits('0.000122009', 16), 0.1);
    });
  });
});
