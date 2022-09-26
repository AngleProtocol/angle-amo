import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers, web3 } from 'hardhat';

import {
  BaseAMOImplem,
  BaseAMOImplem__factory,
  BaseAMOImplem2,
  BaseAMOImplem2__factory,
  MockAMOMinter,
  MockAMOMinter__factory,
  MockTokenPermit,
  MockTokenPermit__factory,
} from '../../../../typechain';
import { expect } from '../../utils/chai-setup';
import { inReceipt } from '../../utils/expectEvent';
import { deployUpgradeable, MAX_UINT256, ZERO_ADDRESS } from '../../utils/helpers';

contract('BaseAMO - Implem', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let baseAMO: BaseAMOImplem;
  let amoMinter: MockAMOMinter;
  let tokenA: MockTokenPermit;
  let tokenB: MockTokenPermit;
  let governor: string;
  let guardian: string;

  const impersonatedSigners: { [key: string]: Signer } = {};

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    // add any addresses you want to impersonate here
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
  });

  beforeEach(async () => {
    baseAMO = (await deployUpgradeable(new BaseAMOImplem__factory(deployer))) as BaseAMOImplem;
    tokenA = (await new MockTokenPermit__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockTokenPermit;
    tokenB = (await new MockTokenPermit__factory(deployer).deploy('USDC', 'USDC', 6)) as MockTokenPermit;
    amoMinter = (await new MockAMOMinter__factory(deployer).deploy()) as MockAMOMinter;
    await baseAMO.initialize(alice.address);
  });
  describe('initializer', () => {
    it('reverts - already initialized', async () => {
      await expect(baseAMO.initialize(bob.address)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero address', async () => {
      const baseAMO2 = (await deployUpgradeable(new BaseAMOImplem__factory(deployer))) as BaseAMOImplem;
      await expect(baseAMO2.initialize(ZERO_ADDRESS)).to.be.revertedWith('ZeroAddress');
    });
    it('success - storage correctly initialized', async () => {
      expect(await baseAMO.amoMinter()).to.be.equal(alice.address);
    });
  });
  describe('setAMOMinter', () => {
    it('reverts - non amoMinter', async () => {
      await expect(baseAMO.connect(deployer).setAMOMinter(deployer.address)).to.be.revertedWith('NotAMOMinter');
    });
    it('success - amo minter updated', async () => {
      await baseAMO.connect(alice).setAMOMinter(bob.address);
      expect(await baseAMO.amoMinter()).to.be.equal(bob.address);
    });
  });
  describe('pull', () => {
    it('reverts - non amoMinter', async () => {
      await expect(baseAMO.connect(deployer).pull([], [], [])).to.be.revertedWith('NotAMOMinter');
    });
    it('success - dummy transaction', async () => {
      await baseAMO.connect(alice).pull([], [], []);
    });
    it('success - dummy transaction on contract that does not override pull', async () => {
      const baseAMO2 = (await deployUpgradeable(new BaseAMOImplem2__factory(deployer))) as BaseAMOImplem2;
      await baseAMO2.initialize(alice.address);
      await baseAMO2.connect(alice).pull([], [], []);
    });
  });
  describe('push', () => {
    it('reverts - non amoMinter', async () => {
      await expect(baseAMO.connect(deployer).push([], [], [])).to.be.revertedWith('NotAMOMinter');
    });
    it('success - dummy transaction', async () => {
      await baseAMO.connect(alice).push([], [], []);
    });
  });
  describe('setToken', () => {
    it('reverts - non amoMinter', async () => {
      await expect(baseAMO.connect(deployer).setToken(ZERO_ADDRESS)).to.be.revertedWith('NotAMOMinter');
    });
    it('success - dummy transaction', async () => {
      await baseAMO.connect(alice).setToken(ZERO_ADDRESS);
    });
  });
  describe('removeToken', () => {
    it('reverts - non amoMinter', async () => {
      await expect(baseAMO.connect(deployer).removeToken(ZERO_ADDRESS)).to.be.revertedWith('NotAMOMinter');
    });
    it('success - dummy transaction', async () => {
      await baseAMO.connect(alice).removeToken(ZERO_ADDRESS);
    });
  });
  describe('revertBytes', () => {
    it('reverts - if error message is non empty', async () => {
      await expect(baseAMO.connect(deployer).revertBytes(web3.utils.keccak256('angle'))).to.be.reverted;
    });
    it('reverts - if empty error message', async () => {
      await expect(baseAMO.connect(deployer).revertBytes('0x')).to.be.revertedWith('OneInchSwapFailed');
    });
  });
  describe('approveMaxSpend', () => {
    it('success - approval given', async () => {
      await baseAMO.approveMaxSpend(tokenA.address, alice.address);
      expect(await tokenA.allowance(baseAMO.address, alice.address)).to.be.equal(MAX_UINT256);
      await baseAMO.approveMaxSpend(tokenB.address, alice.address);
      expect(await tokenB.allowance(baseAMO.address, alice.address)).to.be.equal(MAX_UINT256);
    });
    it('reverts - when non token', async () => {
      await expect(baseAMO.approveMaxSpend(alice.address, alice.address)).to.be.reverted;
    });
    it('reverts - when allowance has already been given', async () => {
      await baseAMO.approveMaxSpend(tokenA.address, alice.address);
      expect(await tokenA.allowance(baseAMO.address, alice.address)).to.be.equal(MAX_UINT256);
      await expect(baseAMO.approveMaxSpend(tokenA.address, alice.address)).to.be.reverted;
    });
  });
  describe('report', () => {
    it('success - protocol makes no gain and no loss', async () => {
      await baseAMO.report(tokenA.address, 0);
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(0);
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(0);
    });
    it('reverts - protocol adds amount but has no outstanding balance', async () => {
      await expect(baseAMO.report(tokenA.address, parseEther('1'))).to.be.reverted;
    });
    it('success - protocol makes a gain', async () => {
      await tokenA.mint(baseAMO.address, parseEther('10'));
      await baseAMO.report(tokenA.address, 0);
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(0);
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('10'));
    });
    it('success - has balance but adds everything so no gain', async () => {
      await tokenA.mint(baseAMO.address, parseEther('10'));
      await baseAMO.report(tokenA.address, parseEther('10'));
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(0);
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(0);
    });
    it('success - makes a loss', async () => {
      await baseAMO.setLastBalance(tokenA.address, parseEther('3'));
      expect(await baseAMO.lastBalances(tokenA.address)).to.be.equal(parseEther('3'));
      await baseAMO.report(tokenA.address, parseEther('0'));
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(parseEther('3'));
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(0);
    });
    it('success - makes a small loss after a gain', async () => {
      await tokenA.mint(baseAMO.address, parseEther('10'));
      await baseAMO.report(tokenA.address, 0);
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(0);
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('10'));
      await baseAMO.setLastBalance(tokenA.address, parseEther('13'));
      expect(await baseAMO.lastBalances(tokenA.address)).to.be.equal(parseEther('13'));
      await baseAMO.report(tokenA.address, parseEther('0'));
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(parseEther('0'));
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('7'));
    });
    it('success - makes a loss and then a gain to offset a part of this loss', async () => {
      await baseAMO.setLastBalance(tokenA.address, parseEther('3'));
      await baseAMO.report(tokenA.address, parseEther('0'));
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(parseEther('3'));
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(0);
      await tokenA.mint(baseAMO.address, parseEther('1'));
      await baseAMO.setLastBalance(tokenA.address, parseEther('0'));
      await baseAMO.report(tokenA.address, parseEther('0'));
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(parseEther('2'));
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(0);
    });
    it('success - makes a loss and then a gain to offset all of this of this loss', async () => {
      await baseAMO.setLastBalance(tokenA.address, parseEther('3'));
      await baseAMO.report(tokenA.address, parseEther('0'));
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(parseEther('3'));
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(0);
      await tokenA.mint(baseAMO.address, parseEther('7'));
      await baseAMO.setLastBalance(tokenA.address, parseEther('0'));
      await baseAMO.report(tokenA.address, parseEther('0'));
      expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(parseEther('0'));
      expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('4'));
    });
  });

  describe('onlyApproved functions', () => {
    beforeEach(async () => {
      await baseAMO.connect(alice).setAMOMinter(amoMinter.address);
      await amoMinter.setIsApproved(alice.address, true);
      await amoMinter.setIsGovernor(bob.address, true);
      await amoMinter.setIsGovernor(alice.address, true);
    });
    describe('changeAllowance', () => {
      it('reverts - not approved', async () => {
        await expect(
          baseAMO.connect(deployer).changeAllowance([alice.address], [alice.address], [alice.address]),
        ).to.be.revertedWith('NotApproved');
        await expect(
          baseAMO.connect(bob).changeAllowance([alice.address], [alice.address], [alice.address]),
        ).to.be.revertedWith('NotApproved');
      });
      it('reverts - incompatible lengths', async () => {
        await expect(
          baseAMO.connect(alice).changeAllowance([tokenA.address, bob.address], [deployer.address], [parseEther('10')]),
        ).to.be.revertedWith('IncompatibleLengths');
        await expect(
          baseAMO.connect(alice).changeAllowance([tokenA.address], [deployer.address, bob.address], [parseEther('10')]),
        ).to.be.revertedWith('IncompatibleLengths');
        await expect(
          baseAMO
            .connect(alice)
            .changeAllowance([tokenA.address], [deployer.address], [parseEther('10'), parseEther('1')]),
        ).to.be.revertedWith('IncompatibleLengths');
        await expect(baseAMO.connect(alice).changeAllowance([], [], [])).to.be.revertedWith('IncompatibleLengths');
      });
      it('reverts - invalid token', async () => {
        await expect(baseAMO.connect(alice).changeAllowance([alice.address], [deployer.address], [parseEther('10')])).to
          .be.reverted;
      });
      it('success - allowance increased', async () => {
        await baseAMO.connect(alice).changeAllowance([tokenA.address], [deployer.address], [parseEther('10')]);
        expect(await tokenA.allowance(baseAMO.address, deployer.address)).to.be.equal(parseEther('10'));
      });
      it('success - allowance increased and then decreased', async () => {
        await baseAMO.connect(alice).changeAllowance([tokenA.address], [deployer.address], [parseEther('10')]);
        expect(await tokenA.allowance(baseAMO.address, deployer.address)).to.be.equal(parseEther('10'));
        await baseAMO.connect(alice).changeAllowance([tokenA.address], [deployer.address], [parseEther('7')]);
        expect(await tokenA.allowance(baseAMO.address, deployer.address)).to.be.equal(parseEther('7'));
      });
      it('success - allowance increased and then stays the same', async () => {
        await baseAMO.connect(alice).changeAllowance([tokenA.address], [deployer.address], [parseEther('10')]);
        expect(await tokenA.allowance(baseAMO.address, deployer.address)).to.be.equal(parseEther('10'));
        await baseAMO.connect(alice).changeAllowance([tokenA.address], [deployer.address], [parseEther('10')]);
        expect(await tokenA.allowance(baseAMO.address, deployer.address)).to.be.equal(parseEther('10'));
      });
      it('success - multiple allowances combined in a single transaction', async () => {
        await baseAMO
          .connect(alice)
          .changeAllowance(
            [tokenA.address, tokenA.address, tokenB.address, tokenA.address, tokenB.address],
            [deployer.address, deployer.address, deployer.address, bob.address, alice.address],
            [parseEther('10'), parseEther('0'), parseEther('4'), parseEther('5'), parseEther('6')],
          );
        expect(await tokenA.allowance(baseAMO.address, deployer.address)).to.be.equal(parseEther('0'));
        expect(await tokenB.allowance(baseAMO.address, deployer.address)).to.be.equal(parseEther('4'));
        expect(await tokenA.allowance(baseAMO.address, bob.address)).to.be.equal(parseEther('5'));
        expect(await tokenB.allowance(baseAMO.address, alice.address)).to.be.equal(parseEther('6'));
      });
    });
    describe('pushSurplus', () => {
      it('reverts - not approved', async () => {
        await expect(baseAMO.connect(deployer).pushSurplus(alice.address, bob.address, [])).to.be.revertedWith(
          'NotApproved',
        );
        await expect(baseAMO.connect(bob).pushSurplus(alice.address, bob.address, [])).to.be.revertedWith(
          'NotApproved',
        );
      });
      it('reverts - zero address', async () => {
        await expect(baseAMO.connect(alice).pushSurplus(tokenA.address, ZERO_ADDRESS, [])).to.be.revertedWith(
          'ZeroAddress',
        );
      });
      it('reverts - when called on non token', async () => {
        await expect(baseAMO.connect(alice).pushSurplus(alice.address, alice.address, [])).to.be.reverted;
      });
      it('success - zero gain and pull function returns zero', async () => {
        const balance = await tokenA.balanceOf(alice.address);
        await baseAMO.connect(alice).pushSurplus(tokenA.address, alice.address, []);
        expect(await tokenA.balanceOf(alice.address)).to.be.equal(balance);
      });
      it('success - when there is a gain but no amount available because pull function', async () => {
        await tokenA.mint(baseAMO.address, parseEther('10'));
        await baseAMO.report(tokenA.address, 0);
        expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(0);
        expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('10'));
        await baseAMO.connect(alice).pushSurplus(tokenA.address, alice.address, []);
        expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('10'));
        expect(await tokenA.balanceOf(baseAMO.address)).to.be.equal(parseEther('10'));
      });
      it('success - when there is a gain and only a small amount available', async () => {
        await tokenA.mint(baseAMO.address, parseEther('10'));
        await baseAMO.report(tokenA.address, 0);
        expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(0);
        expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('10'));
        await baseAMO.connect(alice).setAmountsAvailable(tokenA.address, parseEther('7'));
        await baseAMO.connect(alice).pushSurplus(tokenA.address, alice.address, []);
        expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('3'));
        expect(await tokenA.balanceOf(baseAMO.address)).to.be.equal(parseEther('3'));
        expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('7'));
      });
      it('success - when there is a gain and a huge amount available', async () => {
        await tokenA.mint(baseAMO.address, parseEther('10'));
        await baseAMO.report(tokenA.address, 0);
        expect(await baseAMO.protocolDebts(tokenA.address)).to.be.equal(0);
        expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('10'));
        await baseAMO.connect(alice).setAmountsAvailable(tokenA.address, parseEther('100'));
        await baseAMO.connect(alice).pushSurplus(tokenA.address, alice.address, []);
        expect(await baseAMO.protocolGains(tokenA.address)).to.be.equal(parseEther('0'));
        expect(await tokenA.balanceOf(baseAMO.address)).to.be.equal(parseEther('0'));
        expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('10'));
      });
    });
    describe('claimRewards', () => {
      it('reverts - not approved', async () => {
        await expect(baseAMO.connect(deployer).claimRewards([alice.address])).to.be.revertedWith('NotApproved');
        await expect(baseAMO.connect(bob).claimRewards([alice.address])).to.be.revertedWith('NotApproved');
      });
      it('success - nothing happened when the claim function is not overriden', async () => {
        await baseAMO.connect(alice).claimRewards([]);
        await baseAMO.connect(alice).claimRewards([alice.address]);
        await baseAMO.connect(alice).claimRewards([alice.address, tokenA.address]);
      });
    });
    describe('sellRewards', () => {
      it('reverts - not approved', async () => {
        await expect(baseAMO.connect(deployer).sellRewards(0, '0x')).to.be.revertedWith('NotApproved');
        await expect(baseAMO.connect(bob).sellRewards(0, '0x')).to.be.revertedWith('NotApproved');
      });
      it('reverts - 1Inch not known in localhost', async () => {
        await expect(baseAMO.connect(alice).sellRewards(0, '0x')).to.be.reverted;
      });
    });

    describe('recoverERC20', () => {
      it('reverts - not approved', async () => {
        await expect(baseAMO.connect(deployer).recoverERC20(alice.address, alice.address, 1)).to.be.revertedWith(
          'NotApproved',
        );
        await expect(baseAMO.connect(bob).recoverERC20(alice.address, alice.address, 1)).to.be.revertedWith(
          'NotApproved',
        );
      });
      it('success - tokens recovered', async () => {
        await tokenA.mint(baseAMO.address, parseEther('100'));
        expect(await tokenA.balanceOf(baseAMO.address)).to.be.equal(parseEther('100'));
        const receipt = await (
          await baseAMO.connect(alice).recoverERC20(tokenA.address, alice.address, parseEther('13'))
        ).wait();
        inReceipt(receipt, 'Recovered', {
          tokenAddress: tokenA.address,
          to: alice.address,
          amountToRecover: parseEther('13'),
        });
        expect(await tokenA.balanceOf(baseAMO.address)).to.be.equal(parseEther('87'));
        expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('13'));
      });
    });
    describe('execute', () => {
      it('reverts - not governor', async () => {
        await expect(baseAMO.connect(deployer).execute(alice.address, '0x')).to.be.revertedWith('NotGovernor');
      });
      it('success - execute transaction', async () => {
        const receipt = await tokenA.mint(alice.address, parseEther('1000'));
        const data = receipt.data;
        await baseAMO.connect(alice).execute(tokenA.address, data);
        expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('2000'));
        await baseAMO.connect(bob).execute(tokenA.address, data);
        expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('3000'));
      });
    });
  });
  describe('View functions', () => {
    describe('balance', () => {
      it('reverts - when called on non token', async () => {
        await expect(baseAMO.connect(deployer).balance(alice.address)).to.be.reverted;
      });
      it('success - when just leftover balance', async () => {
        await tokenA.mint(baseAMO.address, parseEther('1000'));
        expect(await baseAMO.balance(tokenA.address)).to.be.equal(parseEther('1000'));
      });
      it('success - when just leftover balance and net assets', async () => {
        await tokenA.mint(baseAMO.address, parseEther('1000'));
        await baseAMO.setNetAssets(tokenA.address, parseEther('13'));
        expect(await baseAMO.balance(tokenA.address)).to.be.equal(parseEther('1013'));
      });
      it('success - when just net assets', async () => {
        await baseAMO.setNetAssets(tokenA.address, parseEther('13'));
        expect(await baseAMO.balance(tokenA.address)).to.be.equal(parseEther('13'));
      });
    });
    describe('getNavOfInvestedAssets', () => {
      it('success - returns 0 when no net assets', async () => {
        expect(await baseAMO.getNavOfInvestedAssets(tokenA.address)).to.be.equal(parseEther('0'));
      });
      it('success - when some net assets', async () => {
        await baseAMO.setNetAssets(tokenA.address, parseEther('13'));
        expect(await baseAMO.getNavOfInvestedAssets(tokenA.address)).to.be.equal(parseEther('13'));
      });
      it('success - on dummy contract', async () => {
        const baseAMO2 = (await deployUpgradeable(new BaseAMOImplem2__factory(deployer))) as BaseAMOImplem2;
        await baseAMO2.initialize(alice.address);
        expect(await baseAMO2.getNavOfInvestedAssets(tokenA.address)).to.be.equal(parseEther('0'));
      });
    });
    describe('debt', () => {
      it('reverts - when invalid amoMinter', async () => {
        await expect(baseAMO.debt(tokenA.address)).to.be.reverted;
      });
      it('success - with valid amoMinter', async () => {
        await baseAMO.connect(alice).setAMOMinter(amoMinter.address);
        expect(await baseAMO.debt(tokenA.address)).to.be.equal(0);
      });
      it('success - with valid amoMinter and non null amount', async () => {
        await baseAMO.connect(alice).setAMOMinter(amoMinter.address);
        await amoMinter.setCallerDebt(tokenA.address, parseEther('10'));
        expect(await baseAMO.debt(tokenA.address)).to.be.equal(parseEther('10'));
      });
    });
  });
});
