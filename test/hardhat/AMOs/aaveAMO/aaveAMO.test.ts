import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract, Signer } from 'ethers';
import { formatBytes32String, parseEther, parseUnits } from 'ethers/lib/utils';
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
import { deploy, expectApprox, MAX_UINT256, ZERO_ADDRESS } from '../../utils/helpers';

contract('AaveAMO', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  let amo: AaveAMO;
  let usdc: ERC20;
  let dai: ERC20;
  let aave: ERC20;
  let weth: ERC20;
  let aToken: ERC20;
  let debtToken: ERC20;
  let aTokenDAI: ERC20;
  let debtTokenDAI: ERC20;
  let aTokenWETH: ERC20;
  let debtTokenWETH: ERC20;
  let stkAave: IStakedAave;

  let amoMinter: MockAMOMinter;
  let aUSDCHolder: string;
  let usdcHolder: string;
  let wethHolder: string;
  let daiHolder: string;
  let oneInch: string;
  let lendingPool: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob, proxyAdmin] = await ethers.getSigners();
    // add any addresses you want to impersonate here
    aUSDCHolder = '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296';
    usdcHolder = '0xCFFAd3200574698b78f32232aa9D63eABD290703';
    wethHolder = '0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0';
    daiHolder = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
    usdc = (await ethers.getContractAt(ERC20__factory.abi, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')) as ERC20;
    dai = (await ethers.getContractAt(ERC20__factory.abi, '0x6B175474E89094C44Da98b954EedeAC495271d0F')) as ERC20;
    weth = (await ethers.getContractAt(ERC20__factory.abi, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')) as ERC20;
    aave = (await ethers.getContractAt(ERC20__factory.abi, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9')) as ERC20;
    aToken = (await ethers.getContractAt(ERC20__factory.abi, '0xBcca60bB61934080951369a648Fb03DF4F96263C')) as ERC20;
    debtToken = (await ethers.getContractAt(ERC20__factory.abi, '0x619beb58998eD2278e08620f97007e1116D5D25b')) as ERC20;

    aTokenDAI = (await ethers.getContractAt(ERC20__factory.abi, '0x028171bCA77440897B824Ca71D1c56caC55b68A3')) as ERC20;
    debtTokenDAI = (await ethers.getContractAt(
      ERC20__factory.abi,
      '0x6C3c78838c761c6Ac7bE9F59fe808ea2A6E4379d',
    )) as ERC20;

    aTokenWETH = (await ethers.getContractAt(
      ERC20__factory.abi,
      '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e',
    )) as ERC20;
    debtTokenWETH = (await ethers.getContractAt(
      ERC20__factory.abi,
      '0xF63B34710400CAd3e044cFfDcAb00a0f32E33eCf',
    )) as ERC20;

    stkAave = (await ethers.getContractAt(
      IStakedAave__factory.abi,
      '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
    )) as IStakedAave;
    oneInch = '0x1111111254fb6c44bAC0beD2854e76F90643097d';
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
    const amoImplementation = (await deploy('AaveAMO')) as AaveAMO;

    const proxy = await deploy('TransparentUpgradeableProxy', [amoImplementation.address, proxyAdmin.address, '0x']);
    amo = new Contract(proxy.address, AaveAMO__factory.createInterface(), deployer) as AaveAMO;

    amoMinter = (await new MockAMOMinter__factory(deployer).deploy()) as MockAMOMinter;
    await amo.initialize(amoMinter.address);
    await amoMinter.setIsApproved(alice.address, true);
  });

  describe('initializer', () => {
    it('reverts - already initialized', async () => {
      await expect(amo.initialize(bob.address)).to.be.revertedWith('Initializable: contract is already initialized');
    });
    it('success - parameters correctly set', async () => {
      expect(await stkAave.allowance(amo.address, oneInch)).to.be.equal(MAX_UINT256);
      expect(await aave.allowance(amo.address, oneInch)).to.be.equal(MAX_UINT256);

      expect(await dai.allowance(amo.address, '0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853')).to.be.equal(MAX_UINT256);
      expect(await dai.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      const daiCollat = await amo.daiBorrowCollatRatio();
      // 0.77 - 0.005
      expect(daiCollat).to.be.equal(parseEther('0.765'));
      expect(await amo.cooldownSeconds()).to.be.equal(await stkAave.COOLDOWN_SECONDS());
      expect(await amo.unstakeWindow()).to.be.equal(await stkAave.UNSTAKE_WINDOW());
      expect(await amo.liquidationWarningThreshold()).to.be.equal(parseEther('0.02'));
    });
  });
  describe('setAavePoolVariables', () => {
    it('success - parameters correctly set', async () => {
      await amo.setAavePoolVariables();
      const cooldownSeconds = await stkAave.COOLDOWN_SECONDS();
      expect(await amo.cooldownSeconds()).to.be.equal(cooldownSeconds);
      expect(cooldownSeconds).to.be.equal(864000);
      expect(await amo.unstakeWindow()).to.be.equal(await stkAave.UNSTAKE_WINDOW());
    });
  });
  describe('setAaveTokenLiqThreshold', () => {
    it('success - parameters correctly set', async () => {
      await amo.setAaveTokenLiqThreshold([usdc.address]);
      // Liq thresold is 0.88 instead of 0.86
      expect((await amo.tokensParams(usdc.address)).liquidationThreshold).to.be.equal(parseEther('0.86'));
    });
  });
  describe('onlyApproved checks', () => {
    it('reverts - onlyApproved functions all fail if they are called by an unapproved address', async () => {
      await expect(amo.connect(bob).fold([alice.address], [parseEther('1')])).to.be.revertedWith('NotApproved');
      await expect(amo.connect(bob).unfold([alice.address], [parseEther('1')])).to.be.revertedWith('NotApproved');
      await expect(amo.connect(bob).toggleLiquidationCheck()).to.be.revertedWith('NotApproved');
      await expect(amo.connect(bob).setLiquidationWarningThreshold(0)).to.be.revertedWith('NotApproved');
      await expect(amo.connect(bob).onFlashLoan(bob.address, bob.address, 1, 1, '0x')).to.be.revertedWith(
        'NotApproved',
      );
    });
  });
  describe('setToken', () => {
    it('success - token correctly set', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      expect((await amo.tokensParams(usdc.address)).liquidationThreshold).to.be.equal(parseEther('0.86'));
      expect((await amo.tokensParams(usdc.address)).aToken).to.be.equal(aToken.address);
      expect((await amo.tokensParams(usdc.address)).debtToken).to.be.equal(debtToken.address);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(MAX_UINT256);
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await amo.activeTokenList(0)).to.be.equal(usdc.address);
    });
    it('success - multiple tokens correctly set', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      expect((await amo.tokensParams(usdc.address)).liquidationThreshold).to.be.equal(parseEther('0.86'));
      expect((await amo.tokensParams(usdc.address)).aToken).to.be.equal(aToken.address);
      expect((await amo.tokensParams(usdc.address)).debtToken).to.be.equal(debtToken.address);
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(MAX_UINT256);
      expect(await amo.activeTokenList(0)).to.be.equal(usdc.address);

      expect((await amo.tokensParams(dai.address)).liquidationThreshold).to.be.equal(parseEther('0.78'));
      expect((await amo.tokensParams(dai.address)).aToken).to.be.equal(aTokenDAI.address);
      expect((await amo.tokensParams(dai.address)).debtToken).to.be.equal(debtTokenDAI.address);
      expect(await dai.allowance(amo.address, amoMinter.address)).to.be.equal(MAX_UINT256);
      expect(await dai.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await amo.activeTokenList(1)).to.be.equal(dai.address);
    });
    it('reverts - invalid token added', async () => {
      await expect(amoMinter.setToken(amo.address, ZERO_ADDRESS)).to.be.reverted;
    });
  });
  describe('removeToken', () => {
    it('reverts - invalid token or token not added', async () => {
      await expect(amoMinter.removeToken(amo.address, ZERO_ADDRESS)).to.be.reverted;
      await expect(amoMinter.removeToken(amo.address, usdc.address)).to.be.reverted;
    });
    it('success - when there is just one token', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.removeToken(amo.address, usdc.address);
      expect((await amo.tokensParams(usdc.address)).liquidationThreshold).to.be.equal(0);
      expect((await amo.tokensParams(usdc.address)).aToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensParams(usdc.address)).debtToken).to.be.equal(ZERO_ADDRESS);
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(0);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      await expect(amo.activeTokenList(0)).to.be.reverted;
    });
    it('success - when token is DAI', async () => {
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.removeToken(amo.address, dai.address);
      expect((await amo.tokensParams(dai.address)).liquidationThreshold).to.be.equal(0);
      expect((await amo.tokensParams(dai.address)).aToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensParams(dai.address)).debtToken).to.be.equal(ZERO_ADDRESS);
      // Allowance to lending pool is kept
      expect(await dai.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await dai.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      await expect(amo.activeTokenList(0)).to.be.reverted;
    });
    it('success - when there are multiple tokens 1/2', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.removeToken(amo.address, usdc.address);
      expect((await amo.tokensParams(usdc.address)).liquidationThreshold).to.be.equal(0);
      expect((await amo.tokensParams(usdc.address)).aToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensParams(usdc.address)).debtToken).to.be.equal(ZERO_ADDRESS);
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(0);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      expect(await amo.activeTokenList(0)).to.be.equal(dai.address);
    });
    it('success - when there are multiple tokens 2/2', async () => {
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.removeToken(amo.address, usdc.address);
      expect((await amo.tokensParams(usdc.address)).liquidationThreshold).to.be.equal(0);
      expect((await amo.tokensParams(usdc.address)).aToken).to.be.equal(ZERO_ADDRESS);
      expect((await amo.tokensParams(usdc.address)).debtToken).to.be.equal(ZERO_ADDRESS);
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(0);
      expect(await usdc.allowance(amo.address, amoMinter.address)).to.be.equal(0);
      expect(await amo.activeTokenList(0)).to.be.equal(dai.address);
    });
    it('reverts - non null balances', async () => {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [aUSDCHolder],
      });
      await hre.network.provider.send('hardhat_setBalance', [aUSDCHolder, '0x10000000000000000000000000000']);
      impersonatedSigners[aUSDCHolder] = await ethers.getSigner(aUSDCHolder);
      await amoMinter.setToken(amo.address, usdc.address);
      await aToken.connect(impersonatedSigners[aUSDCHolder]).transfer(amo.address, 1000);
      await expect(amoMinter.removeToken(amo.address, usdc.address)).to.be.revertedWith('NonNullBalances');
    });
  });
  describe('netAssets + balanceOf', () => {
    it('success - when both aTokens and normal tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      const impersonatedAddresses = [usdcHolder, aUSDCHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('1', 6));
      expect(await amo.balance(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(0);
      await aToken.connect(impersonatedSigners[aUSDCHolder]).transfer(amo.address, parseUnits('1', 6));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.balance(usdc.address)).to.be.equal(parseUnits('2', 6));
    });
    it('reverts - when token was not added', async () => {
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
      await expect(amo.balance(usdc.address)).to.be.reverted;
      await expect(amo.getNavOfInvestedAssets(usdc.address)).to.be.reverted;
    });
  });

  describe('toggleLiquidationCheck', () => {
    it('success - liquidation check toggled and untoggled', async () => {
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(false);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
    });
  });
  describe('setLiquidationWarningThreshold', () => {
    it('reverts - too high parameter value', async () => {
      await expect(amo.connect(alice).setLiquidationWarningThreshold(parseEther('3'))).to.be.revertedWith(
        'TooHighParameterValue',
      );
    });
    it('success - value updated', async () => {
      await amo.connect(alice).setLiquidationWarningThreshold(parseEther('0.5'));
      expect(await amo.liquidationWarningThreshold()).to.be.equal(parseEther('0.5'));
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
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('1', 6));
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256.sub(parseUnits('1', 6)));
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
      expect(await aTokenDAI.balanceOf(amo.address)).to.be.equal(parseEther('1'));
      expect(await dai.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
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
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('1', 6));
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256.sub(parseUnits('1', 6)));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('9', 6));
    });
    it('success - when there are tokens and a profit - DAI', async () => {
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
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('10'));
      await amoMinter.push(amo.address, [dai.address], [parseEther('4')]);
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('10'));
      expect(await aTokenDAI.balanceOf(amo.address)).to.be.equal(parseEther('4'));
      expect(await dai.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await amo.protocolGains(dai.address)).to.be.equal(parseEther('6'));
      expect(await amo.balance(dai.address)).to.be.equal(parseEther('10'));
      expect(await amo.getNavOfInvestedAssets(dai.address)).to.be.equal(parseEther('4'));
    });
    it('success - when multiple tokens are pushed with no profit', async () => {
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
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('1', 6));
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256.sub(parseUnits('1', 6)));
      expect(await amo.balance(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('1'));
      expect(await aTokenDAI.balanceOf(amo.address)).to.be.equal(parseEther('1'));
      expect(await dai.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await amo.balance(dai.address)).to.be.equal(parseEther('1'));
      expect(await amo.getNavOfInvestedAssets(dai.address)).to.be.equal(parseEther('1'));
    });
    it('success - when multiple tokens are pushed with a profit on one', async () => {
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
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('1'));
      await amoMinter.push(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('1')]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('10', 6));
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('1', 6));
      expect(await usdc.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256.sub(parseUnits('1', 6)));
      expect(await amo.balance(usdc.address)).to.be.equal(parseUnits('10', 6));
      expect(await amo.getNavOfInvestedAssets(usdc.address)).to.be.equal(parseUnits('1', 6));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('9', 6));
      expect(await amo.protocolGains(dai.address)).to.be.equal(parseUnits('0', 6));
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('1'));
      expectApprox(await aTokenDAI.balanceOf(amo.address), parseEther('1'), 0.1);
      expect(await dai.allowance(amo.address, lendingPool)).to.be.equal(MAX_UINT256);
      expect(await amo.balance(dai.address)).to.be.equal(parseEther('1'));
      expect(await amo.getNavOfInvestedAssets(dai.address)).to.be.equal(parseEther('1'));
    });

    it('reverts - when there are not enough tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await expect(amoMinter.push(amo.address, [usdc.address], [parseUnits('1', 6)])).to.be.reverted;
    });
  });
  describe('pull', () => {
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
      expect(await amo.lastBalances(dai.address)).to.be.equal(parseEther('5'));
      expect(await amo.protocolGains(dai.address)).to.be.equal(parseEther('7'));
    });
    it('success - when idle tokens and liquidation check is made', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
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
    });
    it('success - when tokens invested and enough liquidity on Aave', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
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
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('0', 6));
      expect(await aToken.balanceOf(amo.address)).to.be.equal(0);
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0', 6));
    });
    it('success - when tokens invested, enough liquidity on Aave and successive portions withdrawn', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
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
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('0.5', 6)]);
      await amo.connect(alice).recoverERC20(usdc.address, bob.address, parseUnits('0.5', 6));
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('0.3', 6)]);
      expectApprox(await amo.lastBalances(usdc.address), parseUnits('0.2', 6), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(usdc.address), parseUnits('0.2', 6), 0.1);
      expectApprox(await amo.balance(usdc.address), parseUnits('0.5', 6), 0.1);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('0.2', 6), 0.1);
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0', 6));
    });
    it('success - when tokens invested and enough liquidity on Aave for multiple tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
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
      await amoMinter.pull(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('1')]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('0', 6));
      // Interest are accumulated in the meantime so DAI balance is not null
      expect(await amo.lastBalances(dai.address)).to.be.gt(0);
      expect(await amo.protocolGains(dai.address)).to.be.gt(0);
      expect(await aToken.balanceOf(amo.address)).to.be.equal(0);
      expect(await aTokenDAI.balanceOf(amo.address)).to.be.gt(0);
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0', 6));
    });
    it('success - when one token invested and not enough liquidity on Aave + no idle tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
      const impersonatedAddresses = [usdcHolder, aToken.address];

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
      const balanceAToken = await usdc.balanceOf(aToken.address);
      await usdc
        .connect(impersonatedSigners[aToken.address])
        .transfer(bob.address, balanceAToken.sub(parseUnits('0.5', 6)));
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('0.5', 6));
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('0.5', 6));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0', 6));
    });
    it('success - when multiple tokens invested and not enough liquidity on Aave for just one token', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, dai.address);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
      const impersonatedAddresses = [usdcHolder, aToken.address, daiHolder];

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
      const balanceAToken = await usdc.balanceOf(aToken.address);
      await usdc
        .connect(impersonatedSigners[aToken.address])
        .transfer(bob.address, balanceAToken.sub(parseUnits('0.5', 6)));
      await amoMinter.pull(amo.address, [usdc.address, dai.address], [parseUnits('1', 6), parseEther('1')]);
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('0.5', 6));
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('0.5', 6));
      // Interest have been accumulated
      expect(await aTokenDAI.balanceOf(amo.address)).to.be.gt(0);
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0', 6));
      expect(await amo.lastBalances(dai.address)).to.be.gt(0);
    });
    it('success - when tokens invested and not enough liquidity on Aave and some idle tokens', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      await amo.connect(alice).toggleLiquidationCheck();
      expect(await amo.liquidationCheck()).to.be.equal(true);
      const impersonatedAddresses = [usdcHolder, aToken.address];

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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('0.3', 6));
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('1', 6));
      const balanceAToken = await usdc.balanceOf(aToken.address);
      await usdc
        .connect(impersonatedSigners[aToken.address])
        .transfer(bob.address, balanceAToken.sub(parseUnits('0.5', 6)));
      await amoMinter.pull(amo.address, [usdc.address], [parseUnits('1', 6)]);
      // We have 0.5 that is still invested
      expect(await amo.lastBalances(usdc.address)).to.be.equal(parseUnits('0.5', 6));
      expect(await aToken.balanceOf(amo.address)).to.be.equal(parseUnits('0.5', 6));
      expect(await amo.protocolGains(usdc.address)).to.be.equal(parseUnits('0.3', 6));
    });
  });

  describe('fold', () => {
    it('reverts - flash Mint fee is taken', async () => {
      await amoMinter.setToken(amo.address, usdc.address);
      const flashLoanAdmin = '0xBE8E3e3618f7474F8cB1d074A26afFef007E98FB';
      const impersonatedAddresses = [usdcHolder, flashLoanAdmin];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      const flashLender = new Contract(
        '0x1EB4CF3A948E7D72A198fe073cCb8C7a948cD853',
        new ethers.utils.Interface(['function file(bytes32 what, uint256 data) external']),
        deployer,
      );
      await flashLender.connect(impersonatedSigners[flashLoanAdmin]).file(formatBytes32String('toll'), 1);
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('100', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('100', 6)]);
      await expect(amo.connect(alice).fold([usdc.address], [parseUnits('110', 6)])).to.be.revertedWith(
        'NonNullFlashMintFee',
      );
    });
    it('success - borrow USDC', async () => {
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('100', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('100', 6)]);
      await amo.connect(alice).fold([usdc.address], [parseUnits('110', 6)]);
      expectApprox(await debtToken.balanceOf(amo.address), parseUnits('110', 6), 0.1);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('210', 6), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(usdc.address), parseUnits('100', 6), 0.1);
      expectApprox(await amo.balance(usdc.address), parseUnits('100', 6), 0.1);
    });

    it('success - borrow DAI', async () => {
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
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('100'));
      await amoMinter.push(amo.address, [dai.address], [parseEther('100')]);
      await amo.connect(alice).fold([dai.address], [parseEther('110')]);
      expectApprox(await debtTokenDAI.balanceOf(amo.address), parseEther('110'), 0.1);
      expectApprox(await aTokenDAI.balanceOf(amo.address), parseEther('210').sub(1), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(dai.address), parseEther('100'), 0.1);
      expectApprox(await amo.balance(dai.address), parseEther('100'), 0.1);
    });

    it('success - borrow wETH', async () => {
      await amoMinter.setToken(amo.address, weth.address);
      const impersonatedAddresses = [wethHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await weth.connect(impersonatedSigners[wethHolder]).transfer(amo.address, parseEther('100'));
      await amoMinter.push(amo.address, [weth.address], [parseEther('100')]);
      await amo.connect(alice).fold([weth.address], [parseEther('110')]);
      expectApprox(await debtTokenWETH.balanceOf(amo.address), parseEther('110'), 0.1);
      expectApprox(await aTokenWETH.balanceOf(amo.address), parseEther('210').sub(1), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(weth.address), parseEther('100'), 0.1);
      expectApprox(await amo.balance(weth.address), parseEther('100'), 0.1);
    });
    it('success - borrow DAI and USDC', async () => {
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.setToken(amo.address, usdc.address);
      const impersonatedAddresses = [daiHolder, usdcHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('100', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('100', 6)]);
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('100'));
      await amoMinter.push(amo.address, [dai.address], [parseEther('100')]);
      await amo.connect(alice).fold([usdc.address, dai.address], [parseUnits('110', 6), parseEther('110')]);
      expectApprox(await debtTokenDAI.balanceOf(amo.address), parseEther('110'), 0.1);
      expectApprox(await aTokenDAI.balanceOf(amo.address), parseEther('210').sub(1), 0.1);
      expectApprox(await debtToken.balanceOf(amo.address), parseUnits('110', 6), 0.1);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('210', 6).sub(1), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(dai.address), parseEther('100'), 0.1);
      expectApprox(await amo.balance(dai.address), parseEther('100'), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(usdc.address), parseUnits('100', 6), 0.1);
      expectApprox(await amo.balance(usdc.address), parseUnits('100', 6), 0.1);
    });
    it('success - borrow DAI and USDC and wETH', async () => {
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.setToken(amo.address, usdc.address);
      await amoMinter.setToken(amo.address, weth.address);
      const impersonatedAddresses = [daiHolder, usdcHolder, wethHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('100', 6));
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('100'));
      await weth.connect(impersonatedSigners[wethHolder]).transfer(amo.address, parseEther('50'));
      await amoMinter.push(
        amo.address,
        [usdc.address, dai.address, weth.address],
        [parseUnits('100', 6), parseEther('100'), parseEther('50')],
      );

      await amo
        .connect(alice)
        .fold([usdc.address, dai.address, weth.address], [parseUnits('110', 6), parseEther('110'), parseEther('55')]);
      expectApprox(await debtTokenDAI.balanceOf(amo.address), parseEther('110'), 0.1);
      expectApprox(await aTokenDAI.balanceOf(amo.address), parseEther('210').sub(1), 0.1);
      expectApprox(await debtToken.balanceOf(amo.address), parseUnits('110', 6), 0.1);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('210', 6).sub(1), 0.1);
      expectApprox(await debtTokenWETH.balanceOf(amo.address), parseEther('55'), 0.1);
      expectApprox(await aTokenWETH.balanceOf(amo.address), parseEther('105').sub(1), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(dai.address), parseEther('100'), 0.1);
      expectApprox(await amo.balance(dai.address), parseEther('100'), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(weth.address), parseEther('50'), 0.1);
      expectApprox(await amo.balance(weth.address), parseEther('50'), 0.1);
      expectApprox(await amo.getNavOfInvestedAssets(usdc.address), parseUnits('100', 6), 0.1);
      expectApprox(await amo.balance(usdc.address), parseUnits('100', 6), 0.1);
    });
    it('success - borrow usdc but need flash-loan greater than max liquidity available', async () => {
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('5', 14));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('5', 14)]);
      await amo.connect(alice).fold([usdc.address], [parseUnits('7', 14)]);
      // Here flash loan size is bigger than 500,000,000: we can take at max: 500,000,000 * 0.76 = 382,500,000
      // But because of the rounding, we'll end up to something smaller than that
      expectApprox(await debtToken.balanceOf(amo.address), parseUnits('3.825', 14), 0.1);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('8.825', 14), 0.1);
    });

    it('success - borrow DAI but need flash-loan greater than max liquidity available', async () => {
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
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseUnits('5', 26));
      await amoMinter.push(amo.address, [dai.address], [parseUnits('5', 26)]);
      await amo.connect(alice).fold([dai.address], [parseUnits('7', 26)]);
      // Here flash loan size is bigger than 500,000,000: we can take at max: 500,000,000 * 0.76 = 382,500,000
      // But because of the rounding, we'll end up to something smaller than that
      expectApprox(await debtTokenDAI.balanceOf(amo.address), parseUnits('3.825', 26), 0.1);
      expectApprox(await aTokenDAI.balanceOf(amo.address), parseUnits('8.825', 26), 0.1);
    });

    it('success - borrow wETH but need flash-loan greater than max liquidity available', async () => {
      await amoMinter.setToken(amo.address, weth.address);
      const impersonatedAddresses = [wethHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await weth.connect(impersonatedSigners[wethHolder]).transfer(amo.address, parseUnits('180', 21));
      await amoMinter.push(amo.address, [weth.address], [parseUnits('180', 21)]);
      await amo.connect(alice).fold([weth.address], [parseUnits('200', 21)]);
      // Here flash loan size is bigger than 500,000,000: we can take at max: 500,000,000 * 0.76 = 382,500,000 -> which
      // divided by 2800 gives approx 137
      // But because of the rounding, we'll end up to something smaller than that
      expectApprox(await debtTokenWETH.balanceOf(amo.address), parseUnits('133.76', 21), 0.1);
      expectApprox(await aTokenWETH.balanceOf(amo.address), parseUnits('313.76', 21), 0.1);
    });

    it('success - borrow multiple tokens making the flash loan liquidity requirement too big', async () => {
      await amoMinter.setToken(amo.address, weth.address);
      await amoMinter.setToken(amo.address, dai.address);
      const impersonatedAddresses = [wethHolder, daiHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseUnits('5', 26));
      await weth.connect(impersonatedSigners[wethHolder]).transfer(amo.address, parseUnits('180', 21));
      await amoMinter.push(amo.address, [weth.address], [parseUnits('180', 21)]);
      await amoMinter.push(amo.address, [dai.address], [parseUnits('5', 26)]);
      await amo.connect(alice).fold([weth.address, dai.address], [parseUnits('200', 21), parseUnits('5', 26)]);
      expectApprox(await debtTokenWETH.balanceOf(amo.address), parseUnits('71.36', 21), 0.1);
      expectApprox(await aTokenWETH.balanceOf(amo.address), parseUnits('251.36', 21), 0.1);
      expectApprox(await debtTokenDAI.balanceOf(amo.address), parseUnits('1.784', 26), 0.1);
      expectApprox(await aTokenDAI.balanceOf(amo.address), parseUnits('6.784', 26), 0.1);
    });
    it('success - several folding one after another', async () => {
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('5', 14));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('5', 14)]);
      await amo.connect(alice).fold([usdc.address], [parseUnits('7', 14)]);
      // At this point we're like above
      await amo.connect(alice).fold([usdc.address], [parseUnits('3', 14)]);

      expectApprox(await debtToken.balanceOf(amo.address), parseUnits('6.825', 14), 0.1);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('11.825', 14), 0.1);
    });

    it('reverts - folding works but fails to respect the health factor check criterion', async () => {
      await amo.connect(alice).toggleLiquidationCheck();
      await amo.connect(alice).setLiquidationWarningThreshold(parseEther('0.7'));
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('5', 14));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('5', 14)]);
      await expect(amo.connect(alice).fold([usdc.address], [parseUnits('7', 14)])).to.be.revertedWith(
        'CloseToLiquidation',
      );
    });
    it('reverts - folding succeeds but liquidation warning threshold update makes pull impossible', async () => {
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('100', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('100', 6)]);
      await amo.connect(alice).fold([usdc.address], [parseUnits('110', 6)]);
      await amo.connect(alice).toggleLiquidationCheck();
      await amo.connect(alice).setLiquidationWarningThreshold(parseEther('0.7'));
      await amo.connect(alice).setAaveTokenLiqThreshold([usdc.address]);
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('10', 6));
      await expect(amoMinter.pull(amo.address, [usdc.address], [parseUnits('10', 6)])).to.be.revertedWith(
        'CloseToLiquidation',
      );
    });
  });

  describe('unfold', () => {
    it('reverts - not enough in the asset', async () => {
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
      await expect(amo.connect(alice).unfold([usdc.address], [parseUnits('1')])).to.be.reverted;
    });
    it('success - unfolds all of the asset', async () => {
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('100', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('100', 6)]);
      await amo.connect(alice).fold([usdc.address], [parseUnits('110', 6)]);
      await amo.connect(alice).unfold([usdc.address], [parseUnits('110', 6)]);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('100', 6), 0.1);
    });
    it('success - just unfolds a portion of the asset - USDC', async () => {
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
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('100', 6));
      await amoMinter.push(amo.address, [usdc.address], [parseUnits('100', 6)]);
      await amo.connect(alice).fold([usdc.address], [parseUnits('110', 6)]);
      await amo.connect(alice).unfold([usdc.address], [parseUnits('60', 6)]);
      expectApprox(await debtToken.balanceOf(amo.address), parseUnits('50', 6), 0.01);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('150', 6), 0.1);
    });
    it('success - just unfolds a portion of the asset - DAI', async () => {
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
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('100'));

      await amoMinter.push(amo.address, [dai.address], [parseEther('100')]);
      await amo.connect(alice).fold([dai.address], [parseEther('110')]);
      await amo.connect(alice).unfold([dai.address], [parseEther('60')]);
      expectApprox(await debtTokenDAI.balanceOf(amo.address), parseEther('50'), 0.01);
      expectApprox(await aTokenDAI.balanceOf(amo.address), parseEther('150'), 0.1);
    });
    it('success - unfolds two assets - DAI and USDC', async () => {
      await amoMinter.setToken(amo.address, dai.address);
      await amoMinter.setToken(amo.address, usdc.address);
      const impersonatedAddresses = [daiHolder, usdcHolder];

      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await dai.connect(impersonatedSigners[daiHolder]).transfer(amo.address, parseEther('100'));
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('100', 6));
      await amoMinter.push(amo.address, [dai.address, usdc.address], [parseEther('100'), parseUnits('100', 6)]);
      await amo.connect(alice).fold([dai.address, usdc.address], [parseEther('110'), parseUnits('100', 6)]);
      await amo.connect(alice).unfold([dai.address, usdc.address], [parseEther('60'), parseUnits('60', 6)]);
      expectApprox(await debtTokenDAI.balanceOf(amo.address), parseEther('50'), 0.1);
      expectApprox(await aTokenDAI.balanceOf(amo.address), parseEther('150'), 0.1);
      expectApprox(await debtToken.balanceOf(amo.address), parseUnits('40', 6), 0.1);
      expectApprox(await aToken.balanceOf(amo.address), parseUnits('140', 6), 0.1);
    });
  });
  describe('sellRewards', () => {
    // We're going to sell 10 USDC in DAI
    it('reverts - when no allowance or invalid payload', async () => {
      await expect(amo.connect(alice).sellRewards(0, '0x')).to.be.reverted;
      const impersonatedAddresses = [usdcHolder];
      const payload =
        '0x2e95b6c8000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000000' +
        '9896800000000000000000000000000000000000000000000000007d86502134661c13000000000000000000000000000000000000000000000000000000000000008' +
        '0000000000000000000000000000000000000000000000000000000000000000180000000000000003b6d0340aaf5110db6e744ff70fb339de037b990a20bdacecfee7c08';
      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('10', 6));
      await expect(amo.connect(alice).sellRewards(0, payload)).to.be.reverted;
    });
    it('success - when allowance granted to 1Inch router', async () => {
      const impersonatedAddresses = [usdcHolder];
      const payload =
        '0x2e95b6c8000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000009' +
        '896800000000000000000000000000000000000000000000000007d86502134661c130000000000000000000000000000000000000000000000000000000000000080' +
        '000000000000000000000000000000000000000000000000000000000000000180000000000000003b6d0340aaf5110db6e744ff70fb339de037b990a20bdacecfee7c08';
      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('10', 6));
      await amo.connect(alice).changeAllowance([usdc.address], [oneInch], [parseUnits('10', 6)]);
      expect(await usdc.allowance(amo.address, oneInch)).to.be.equal(parseUnits('10', 6));
      await amo.connect(alice).sellRewards(0, payload);
      expect(await usdc.balanceOf(amo.address)).to.be.equal(0);
      expect(await dai.balanceOf(amo.address)).to.be.gt(parseEther('9'));
    });
    it('reverts - when slippage got too big', async () => {
      const impersonatedAddresses = [usdcHolder];
      const payload =
        '0x2e95b6c8000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000098' +
        '96800000000000000000000000000000000000000000000000007d86502134661c13000000000000000000000000000000000000000000000000000000000000008000' +
        '0000000000000000000000000000000000000000000000000000000000000180000000000000003b6d0340aaf5110db6e744ff70fb339de037b990a20bdacecfee7c08';
      for (const address of impersonatedAddresses) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address],
        });
        await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
        impersonatedSigners[address] = await ethers.getSigner(address);
      }
      await usdc.connect(impersonatedSigners[usdcHolder]).transfer(amo.address, parseUnits('10', 6));
      await amo.connect(alice).changeAllowance([usdc.address], [oneInch], [parseUnits('10', 6)]);
      expect(await usdc.allowance(amo.address, oneInch)).to.be.equal(parseUnits('10', 6));
      await expect(amo.connect(alice).sellRewards(parseEther('100'), payload)).to.be.revertedWith('TooSmallAmountOut');
    });
  });
});
