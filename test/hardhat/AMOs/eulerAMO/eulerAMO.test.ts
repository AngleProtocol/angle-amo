import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers, network } from 'hardhat';

import {
  ERC20,
  ERC20__factory,
  EulerAMO,
  EulerAMO__factory,
  MockAMOMinter,
  MockAMOMinter__factory,
} from '../../../../typechain';
import { expect } from '../../utils/chai-setup';
import { deployUpgradeable, expectApprox, increaseTime, MAX_UINT256, ZERO_ADDRESS } from '../../utils/helpers';

contract('EulerAMO', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let amo: EulerAMO;
  let usdc: ERC20;
  let dai: ERC20;
  let weth: ERC20;
  let eTokenUSDC: ERC20;
  let dTokenUSDC: ERC20;
  let eTokenDAI: ERC20;
  let dTokenDAI: ERC20;
  let eTokenWETH: ERC20;
  let dTokenWETH: ERC20;

  let amoMinter: MockAMOMinter;
  let usdcHolder: string;
  let wethHolder: string;
  let daiHolder: string;
  let euler: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    usdcHolder = '0xCFFAd3200574698b78f32232aa9D63eABD290703';
    wethHolder = '0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0';
    daiHolder = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
    usdc = (await ethers.getContractAt(ERC20__factory.abi, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')) as ERC20;
    dai = (await ethers.getContractAt(ERC20__factory.abi, '0x6B175474E89094C44Da98b954EedeAC495271d0F')) as ERC20;
    weth = (await ethers.getContractAt(ERC20__factory.abi, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')) as ERC20;

    eTokenUSDC = (await ethers.getContractAt(
      ERC20__factory.abi,
      '0xEb91861f8A4e1C12333F42DCE8fB0Ecdc28dA716',
    )) as ERC20;
    dTokenUSDC = (await ethers.getContractAt(
      ERC20__factory.abi,
      '0x84721A3dB22EB852233AEAE74f9bC8477F8bcc42',
    )) as ERC20;

    eTokenDAI = (await ethers.getContractAt(ERC20__factory.abi, '0xe025E3ca2bE02316033184551D4d3Aa22024D9DC')) as ERC20;
    dTokenDAI = (await ethers.getContractAt(ERC20__factory.abi, '0x6085Bc95F506c326DCBCD7A6dd6c79FBc18d4686')) as ERC20;

    eTokenWETH = (await ethers.getContractAt(
      ERC20__factory.abi,
      '0x1b808F49ADD4b8C6b5117d9681cF7312Fcf0dC1D',
    )) as ERC20;
    dTokenWETH = (await ethers.getContractAt(
      ERC20__factory.abi,
      '0x62e28f054efc24b26A794F5C1249B6349454352C',
    )) as ERC20;

    euler = '0x27182842E098f60e3D576794A5bFFb0777E025d3';
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
    amo = (await deployUpgradeable(new EulerAMO__factory(deployer))) as EulerAMO;
    amoMinter = (await new MockAMOMinter__factory(deployer).deploy()) as MockAMOMinter;
    await amo.initialize(amoMinter.address);
    await amoMinter.setIsApproved(alice.address, true);
  });
  describe('initializer', () => {
    it('success - parameters correctly set and already initialized', async () => {
      await expect(amo.initialize(bob.address)).to.be.revertedWith('Initializable: contract is already initialized');
      expect(await amo.amoMinter()).to.be.equal(amoMinter.address);
    });
  });
  describe('setToken', () => {
    it('success - tokens correctly set', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(MAX_UINT256);
      expect((await amo.tokensAddresses(usdc.address)).eToken).to.be.equal(eTokenUSDC.address);
      expect((await amo.tokensAddresses(usdc.address)).dToken).to.be.equal(dTokenUSDC.address);
      await amoMinter.setToken(amo.address, dai.address);
      expect(await dai.allowance(amo.address, amoMinter.address)).to.be.equal(MAX_UINT256);
      expect((await amo.tokensAddresses(dai.address)).eToken).to.be.equal(eTokenDAI.address);
      expect((await amo.tokensAddresses(dai.address)).dToken).to.be.equal(dTokenDAI.address);
      await amoMinter.setToken(amo.address, weth.address);
      expect(await weth.allowance(amo.address, amoMinter.address)).to.be.equal(MAX_UINT256);
      expect((await amo.tokensAddresses(weth.address)).eToken).to.be.equal(eTokenWETH.address);
      expect((await amo.tokensAddresses(weth.address)).dToken).to.be.equal(dTokenWETH.address);
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(0);
      expect(await amo.getNavOfInvestedAssets(dai.address)).to.be.equal(0);
      expect(await amo.getNavOfInvestedAssets(weth.address)).to.be.equal(0);
    });
    it('reverts - invalid token added', async () => {
      await expect(amoMinter.setToken(amo.address, ZERO_ADDRESS)).to.be.reverted;
    });
  });
  describe('removeToken', () => {
    it('success - tokens correctly removed', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.removeToken(amo.address, usdc.address);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      expect((await amo.tokensAddresses(usdc.address)).eToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensAddresses(usdc.address)).dToken).to.be.equal(ZERO_ADDRESS);
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.removeToken(amo.address, dai.address);
      expect(await dai.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      expect((await amo.tokensAddresses(dai.address)).eToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensAddresses(dai.address)).dToken).to.be.equal(ZERO_ADDRESS);
      await amoMinter.setToken(amo.address, weth.address);
      await amoMinter.removeToken(amo.address, weth.address);
      expect(await weth.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      expect((await amo.tokensAddresses(weth.address)).eToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensAddresses(weth.address)).dToken).to.be.equal(ZERO_ADDRESS);
      await expect(amo.getNavOfInvestedAssets(usdc.address)).to.be.reverted;
      await expect(amo.getNavOfInvestedAssets(dai.address)).to.be.reverted;
      await expect(amo.getNavOfInvestedAssets(weth.address)).to.be.reverted;
    });
    it('reverts - invalid token removed or success but for a token that has not been added', async () => {
      await expect(amoMinter.removeToken(amo.address, ZERO_ADDRESS)).to.be.reverted;
      await amoMinter.removeToken(amo.address, usdc.address);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      expect((await amo.tokensAddresses(usdc.address)).eToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensAddresses(usdc.address)).dToken).to.be.equal(ZERO_ADDRESS);
    });
  });

  describe('push', () => {
    it('reverts - when token have not been added', async () => {
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
      await expect(amoMinter.push(amo.address, [usdc.address], [parseUnits('1', 6)])).to.be.reverted;
    });
    it('success - when there are tokens and no profits - USDC', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
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
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await usdc.allowance(amo.address, euler)).to.be.equal(0);
      expect(await usdc.balanceOf(amo.address)).to.be.equal(0);
      const eTokenUSDCImproved = new Contract(
        eTokenUSDC.address,
        new ethers.utils.Interface([
          'function balanceOfUnderlying(address concerned) external view returns(uint256)',
          'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
        ]),
        deployer,
      );
      expectApprox(await eTokenUSDCImproved.balanceOfUnderlying(amo.address), parseUnits('1', 6), 0.1);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(parseUnits('1', 6)),
        0.1,
      );
    });
    it('success - when multiple successive pushs - USDC', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('1', 6)]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('2', 6));
      expect(await usdc.allowance(amo.address, euler)).to.be.equal(0);
      expect(await usdc.balanceOf(amo.address)).to.be.equal(0);
      const eTokenUSDCImproved = new Contract(
        eTokenUSDC.address,
        new ethers.utils.Interface([
          'function balanceOfUnderlying(address concerned) external view returns(uint256)',
          'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
        ]),
        deployer,
      );
      expectApprox(await eTokenUSDCImproved.balanceOfUnderlying(amo.address), parseUnits('2', 6), 0.1);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(parseUnits('2', 6)),
        0.1,
      );
    });
    it('success - when there are tokens and no profits - DAI', async () => {
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [daiHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('1'));
      await amoMinter.push(amo.address, [dai.address], [parseEther('1')]);
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('1'));

      expect(await dai.allowance(amo.address, euler)).to.be.equal(0);
      expect(await dai.balanceOf(amo.address)).to.be.equal(0);
      const eTokenDAIImproved = new Contract(
        eTokenDAI.address,
        new ethers.utils.Interface([
          'function balanceOfUnderlying(address concerned) external view returns(uint256)',
          'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
        ]),
        deployer,
      );
      expectApprox(await eTokenDAIImproved.balanceOfUnderlying(amo.address), parseEther('1'), 0.1);
      expectApprox(
        await eTokenDAI.balanceOf(amo.address),
        await eTokenDAIImproved.convertUnderlyingToBalance(parseEther('1')),
        0.1,
      );
    });
    it('success - when there are tokens and a profit - USDC', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      const impersonatedAddresses = [usdcHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('10', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('1', 6)]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('10', 6));
      expect(await eTokenUSDC.balanceOf(amo.address)).to.be.gt(0);
      expect(await usdc.allowance(amo.address, euler)).to.be.equal(0);
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('9', 6));
    });
    it('success - when multiple tokens are pushed with no profit', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.setToken(amo.address, weth.address);
      const impersonatedAddresses = [usdcHolder, daiHolder, wethHolder];

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
      await weth.connect(impersonatedSigners[wethHolder]).transfer(amo.address, parseEther('2'));
      await amoMinter.push(
        amo.address,
        [usdc.address, dai.address, weth.address],
        [parseUnits('1', 6), parseEther('1'), parseEther('2')],
      );
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('1'));
      expect(await amo.lastBalances(weth.address)).to.be.equal(parseEther('2'));

      expectApprox(await amo.balance(usdc.address), parseUnits('1', 6), 0.1);
      expectApprox(await amo.balance(dai.address), parseEther('1'), 0.1);
      expectApprox(await amo.balance(weth.address), parseEther('2'), 0.1);

      expectApprox(await amo.getNavOfInvestedAssets(usdc.address), parseUnits('1', 6), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(dai.address), parseEther('1'), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(weth.address), parseEther('2'), 0.1);

      expect(await usdc.allowance(amo.address, euler)).to.be.equal(0);
      expect(await dai.allowance(amo.address, euler)).to.be.equal(0);
      expect(await weth.allowance(amo.address, euler)).to.be.equal(0);

      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
        'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
      ]);

      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      const eTokenDAIImproved = new Contract(eTokenDAI.address, interfaceContract, deployer);
      const eTokenWETHImproved = new Contract(eTokenWETH.address, interfaceContract, deployer);
      expectApprox(await eTokenUSDCImproved.balanceOfUnderlying(amo.address), parseUnits('1', 6), 0.1);
      expectApprox(await eTokenDAIImproved.balanceOfUnderlying(amo.address), parseEther('1'), 0.1);
      expectApprox(await eTokenWETHImproved.balanceOfUnderlying(amo.address), parseEther('2'), 0.1);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(parseUnits('1', 6)),
        0.1,
      );
      expectApprox(
        await eTokenDAI.balanceOf(amo.address),
        await eTokenDAIImproved.convertUnderlyingToBalance(parseEther('1')),
        0.1,
      );
      expectApprox(
        await eTokenWETH.balanceOf(amo.address),
        await eTokenWETHImproved.convertUnderlyingToBalance(parseEther('2')),
        0.1,
      );
    });
    it('success - when multiple tokens are pushed with a profit on one', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.setToken(amo.address, weth.address);
      const impersonatedAddresses = [usdcHolder, daiHolder, wethHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('10', 6));
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('1'));
      await weth.connect(impersonatedSigners[wethHolder]).transfer(amo.address, parseEther('2'));
      await amoMinter.push(
        amo.address,
        [usdc.address, dai.address, weth.address],
        [parseUnits('1', 6), parseEther('1'), parseEther('2')],
      );

      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('10', 6));
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('1'));
      expect(await amo.lastBalances(weth.address)).to.be.equal(parseEther('2'));

      expectApprox(await amo.balance(usdc.address), parseUnits('10', 6), 0.1);
      expectApprox(await amo.balance(dai.address), parseEther('1'), 0.1);
      expectApprox(await amo.balance(weth.address), parseEther('2'), 0.1);

      expectApprox(await amo.getNavOfInvestedAssets(usdc.address), parseUnits('1', 6), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(dai.address), parseEther('1'), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(weth.address), parseEther('2'), 0.1);

      expect(await usdc.allowance(amo.address, euler)).to.be.equal(0);
      expect(await dai.allowance(amo.address, euler)).to.be.equal(0);
      expect(await weth.allowance(amo.address, euler)).to.be.equal(0);

      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
        'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
      ]);

      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      const eTokenDAIImproved = new Contract(eTokenDAI.address, interfaceContract, deployer);
      const eTokenWETHImproved = new Contract(eTokenWETH.address, interfaceContract, deployer);
      expectApprox(await eTokenUSDCImproved.balanceOfUnderlying(amo.address), parseUnits('1', 6), 0.1);
      expectApprox(await eTokenDAIImproved.balanceOfUnderlying(amo.address), parseEther('1'), 0.1);
      expectApprox(await eTokenWETHImproved.balanceOfUnderlying(amo.address), parseEther('2'), 0.1);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(parseUnits('1', 6)),
        0.1,
      );
      expectApprox(
        await eTokenDAI.balanceOf(amo.address),
        await eTokenDAIImproved.convertUnderlyingToBalance(parseEther('1')),
        0.1,
      );
      expectApprox(
        await eTokenWETH.balanceOf(amo.address),
        await eTokenWETHImproved.convertUnderlyingToBalance(parseEther('2')),
        0.1,
      );

      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('9', 6));
      expect(await amo.protocolGains(dai.address)).to.be.equal(parseUnits('0', 6));
      expect(await amo.protocolGains(weth.address)).to.be.equal(parseUnits('0', 6));
    });
  });
  describe('pull', () => {
    it('reverts - when no idle tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await expect(amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)])).to.be.reverted;
    });
    it('success - when idle tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      const impersonatedAddresses = [usdcHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('10', 6));
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('9', 6));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('10', 6));
      expect(await amo.balance(usdc.address)).to.be.equal(parseUnits('10', 6));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(0);
    });

    it('success - when idle tokens for multiple tokens', async () => {
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('10', 6));
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('7'));
      await amoMinter.pull(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('2')]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('9', 6));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('10', 6));
      expect(await amo.balance(usdc.address)).to.be.equal(parseUnits('10', 6));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(0);
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('5'));
      expect(await amo.protocolGains(dai.address)).to.be.equal(parseEther('7'));
      expect(await amo.balance(dai.address)).to.be.equal(parseEther('7'));
      expect(await amo.getNavOfInvestedAssets(dai.address)).to.be.equal(0);
    });

    it('success - when tokens invested and enough liquidity on Euler to withdraw', async () => {
      await amoMinter.setToken(amo.address, usdc.address);

      const impersonatedAddresses = [usdcHolder];
      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
      ]);
      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('1', 6)]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await eTokenUSDCImproved.balanceOfUnderlying(amo.address)).to.be.gt(0);
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('0', 6));

      expect(await eTokenUSDCImproved.balanceOfUnderlying(amo.address)).to.be.equal(0);
      // Protocol has pulled everything but there is leftover
      expect(await eTokenUSDC.balanceOf(amo.address)).to.be.gt(0);
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0', 6));
      expect(await amo.balance(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(0);
    });
    it('success - when tokens invested for a long time and enough liquidity on Euler to withdraw', async () => {
      await amoMinter.setToken(amo.address, usdc.address);

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
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      await increaseTime(365 * 24 * 3600);
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)]);
      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
        'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
      ]);
      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      const tokenBalance = await eTokenUSDCImproved.balanceOfUnderlying(amo.address);
      // Normally we have made 7.6795%
      expectApprox(tokenBalance, parseUnits('0.076795', 6), 0.1);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(parseUnits('0.076795', 6)),
        0.1,
      );
      // Protocol has pulled everything but there is leftover
      expect(await amo.lastBalances(usdc.address)).to.be.equal(tokenBalance);
      expect(await amo.protocolGains(usdc.address)).to.be.equal(tokenBalance);
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(tokenBalance);
      expectApprox(await amo.balance(usdc.address), parseUnits('1', 6).add(tokenBalance), 0.1);
    });
    it('success - when tokens invested for a long time but a portion is withdrawn', async () => {
      await amoMinter.setToken(amo.address, usdc.address);

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
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      await increaseTime(365 * 24 * 3600);
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('0.5', 6)]);
      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
        'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
      ]);
      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      const tokenBalance = await eTokenUSDCImproved.balanceOfUnderlying(amo.address);
      // Normally we have made 7.6795%
      expectApprox(tokenBalance, parseUnits('0.576795', 6), 0.1);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(parseUnits('0.576795', 6)),
        0.1,
      );
      expect(await amo.lastBalances(usdc.address)).to.be.equal(tokenBalance);
      expect(await amo.protocolGains(usdc.address)).to.be.equal(tokenBalance.sub(parseUnits('0.5', 6)));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(tokenBalance);
      expectApprox(
        await amo.balance(usdc.address),
        parseUnits('1', 6).add(tokenBalance).sub(parseUnits('0.5', 6)),
        0.1,
      );
    });
    it('success - when tokens invested for a long time but portions are withdrawn little by little', async () => {
      await amoMinter.setToken(amo.address, usdc.address);

      const impersonatedAddresses = [usdcHolder];
      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
        'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
      ]);
      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('1', 6)]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      await increaseTime(365 * 24 * 3600);
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('0.5', 6)]);
      // We need to recover leftover tokens that is to say what we have pulled
      await amo.connect(alice).recoverERC20(usdc.address, bob.address, parseUnits('0.5', 6));
      await increaseTime(365 * 24 * 3600);
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('0.3', 6)]);

      const tokenBalance = await eTokenUSDCImproved.balanceOfUnderlying(amo.address);
      // Normally we have made 7% on 1 for a year and then 7% on 0.5 for another year
      expectApprox(tokenBalance, parseUnits('0.344451', 6), 0.1);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(parseUnits('0.344451', 6)),
        0.1,
      );
      // Protocol has pulled everything but there is leftover
      expect(await eTokenUSDC.balanceOf(amo.address)).to.be.gt(0);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(tokenBalance);
      // Gains is our remaining balance minus the 0.2 we have brought
      expect(await amo.protocolGains(usdc.address)).to.be.equal(tokenBalance.sub(parseUnits('0.2', 6)));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(tokenBalance);
      expectApprox(
        await amo.balance(usdc.address),
        parseUnits('0.5', 6).add(tokenBalance).sub(parseUnits('0.2', 6)),
        0.1,
      );
    });
    it('success - when tokens invested for a long time and enough liquidity on Euler for multiple tokens', async () => {
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
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('1'));
      await increaseTime(365 * 24 * 3600);
      await amoMinter.pull(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('1')]);
      // Interest are accumulated in the meantime so balances are not null
      const lastBalancesUSDC = await amo.lastBalances(usdc.address);
      const lastBalancesDAI = await amo.lastBalances(dai.address);
      expect(lastBalancesUSDC).to.be.gt(0);
      expect(lastBalancesDAI).to.be.gt(0);
      expectApprox(await amo.balance(usdc.address), parseUnits('1', 6).add(lastBalancesUSDC), 0.1);
      expectApprox(await amo.balance(dai.address), parseEther('1').add(lastBalancesDAI), 0.1);

      expect(await eTokenUSDC.balanceOf(amo.address)).to.be.gt(0);
      expect(await eTokenDAI.balanceOf(amo.address)).to.be.gt(0);

      expect(await amo.protocolGains(usdc.address)).to.be.equal(lastBalancesUSDC);
      expect(await amo.protocolGains(dai.address)).to.be.equal(lastBalancesDAI);

      expectApprox(await amo.getNavOfInvestedAssets(usdc.address), lastBalancesUSDC, 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(dai.address), lastBalancesDAI, 0.1);
    });
    it('success - when one token invested and not enough liquidity on Euler + no idle tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      const impersonatedAddresses = [usdcHolder, euler];

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
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      const balanceEToken = await usdc.balanceOf(euler);
      await usdc.connect(impersonatedSigners[euler]).transfer(bob.address, balanceEToken.sub(parseUnits('0.5', 6)));
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)]);
      // Because of the balanceOfUnderlying stuff: it's unclear how much is leftover
      const lastBalances = await amo.lastBalances(usdc.address);
      expect(lastBalances).to.be.gt(parseUnits('1', 5));
      // In this case getNavOfInvestedAssets returns significantly less which creates a loss in the case of Euler
      expect(await amo.protocolDebts(usdc.address)).to.be.equal(parseUnits('0.5', 6).sub(lastBalances));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(0);
      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
        'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
      ]);
      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      const underlyingBalance = await eTokenUSDCImproved.balanceOfUnderlying(amo.address);
      expect(underlyingBalance).to.be.equal(lastBalances);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(lastBalances),
        0.1,
      );
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(lastBalances);
      expect(await amo.balance(usdc.address)).to.be.equal(lastBalances.add(parseUnits('0.5', 6)));
    });
    it('success - when multiple tokens invested and not enough liquidity on Euler for just one token', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [usdcHolder, euler, daiHolder];

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
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('1'));
      const balanceEToken = await usdc.balanceOf(euler);
      await usdc.connect(impersonatedSigners[euler]).transfer(bob.address, balanceEToken.sub(parseUnits('0.5', 6)));
      // Not all of DAI is withdrawn
      await amoMinter.pull(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('0.5')]);
      // Because of the balanceOfUnderlying stuff: it's unclear how much is leftover, but still less than initially
      const lastBalances = await amo.lastBalances(usdc.address);
      expect(lastBalances).to.be.gt(parseUnits('1', 5));
      // In this case getNavOfInvestedAssets returns significantly less which creates a loss in the case of Euler
      expect(await amo.protocolDebts(usdc.address)).to.be.equal(parseUnits('0.5', 6).sub(lastBalances));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(0);
      const eTokenBalance = await eTokenUSDC.balanceOf(amo.address);
      expect(eTokenBalance).to.be.gt(0);
      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
        'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
      ]);
      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      const underlyingBalance = await eTokenUSDCImproved.balanceOfUnderlying(amo.address);
      expect(underlyingBalance).to.be.equal(lastBalances);
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(lastBalances);
      expect(await amo.balance(usdc.address)).to.be.equal(lastBalances.add(parseUnits('0.5', 6)));

      const eTokenDAIImproved = new Contract(eTokenDAI.address, interfaceContract, deployer);
      const tokenBalance = await eTokenDAIImproved.balanceOfUnderlying(amo.address);
      expect(tokenBalance).to.be.gt(parseEther('0.5'));
      expectApprox(
        await eTokenDAI.balanceOf(amo.address),
        await eTokenDAIImproved.convertUnderlyingToBalance(tokenBalance),
        0.1,
      );
      // Protocol has pulled everything but there is leftover
      expect(await eTokenDAI.balanceOf(amo.address)).to.be.gt(0);
      expectApprox(await amo.lastBalances(dai.address), tokenBalance, 0.1);
      expectApprox(await amo.protocolGains(dai.address), tokenBalance.sub(parseEther('0.5')), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(dai.address), tokenBalance, 0.1);
      expectApprox(await amo.balance(dai.address), parseEther('1').add(tokenBalance).sub(parseEther('0.5')), 0.1);
    });

    it('success - when tokens invested and not enough liquidity on Euler and some idle tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      const impersonatedAddresses = [usdcHolder, euler];

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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('0.5', 6));
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      const balanceEToken = await usdc.balanceOf(euler);
      await usdc.connect(impersonatedSigners[euler]).transfer(bob.address, balanceEToken.sub(parseUnits('0.5', 6)));
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)]);
      // Because of the balanceOfUnderlying stuff: it's unclear how much is leftover: we had 1 of net assets, but no longer have 1
      // Net assets should be something like 0.823 + 0.5 of idle tokens which makes a gain
      const lastBalances = await amo.lastBalances(usdc.address);
      expect(lastBalances).to.be.gt(parseUnits('1', 5));
      // In this case getNavOfInvestedAssets returns significantly less which creates a loss in the case of Euler
      expect(await amo.protocolDebts(usdc.address)).to.be.equal(0);
      // Gain is 0.5 - loss made through the insufficient liquidity = 323011
      expect(await amo.protocolGains(usdc.address)).to.be.equal(lastBalances);
      const interfaceContract = new ethers.utils.Interface([
        'function balanceOfUnderlying(address concerned) external view returns(uint256)',
        'function convertUnderlyingToBalance(uint underlyingAmount) external view returns (uint)',
      ]);
      const eTokenUSDCImproved = new Contract(eTokenUSDC.address, interfaceContract, deployer);
      const underlyingBalance = await eTokenUSDCImproved.balanceOfUnderlying(amo.address);
      expect(underlyingBalance).to.be.equal(lastBalances);
      expectApprox(
        await eTokenUSDC.balanceOf(amo.address),
        await eTokenUSDCImproved.convertUnderlyingToBalance(lastBalances),
        0.1,
      );
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(lastBalances);
      // We have the  1+0.5 minus the loss and 0.5 - loss is lastBalances
      expect(await amo.balance(usdc.address)).to.be.equal(lastBalances.add(parseUnits('1', 6)));
    });
  });
});
