import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Signer } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import hre, { contract, ethers } from 'hardhat';

import {
  AMOMinter,
  AMOMinter__factory,
  MockAMO,
  MockAMO__factory,
  MockCoreBorrow,
  MockCoreBorrow__factory,
  MockTokenPermit,
  MockTokenPermit__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { inReceipt } from '../utils/expectEvent';
import { deployUpgradeable, ZERO_ADDRESS } from '../utils/helpers';

contract('AMOMinter', () => {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let amoMinter: AMOMinter;
  let tokenA: MockTokenPermit;
  let tokenB: MockTokenPermit;
  let coreBorrow: MockCoreBorrow;
  let amo: MockAMO;
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
    coreBorrow = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
    amo = (await new MockAMO__factory(deployer).deploy()) as MockAMO;
    tokenA = (await new MockTokenPermit__factory(deployer).deploy('agEUR', 'agEUR', 18)) as MockTokenPermit;
    tokenB = (await new MockTokenPermit__factory(deployer).deploy('USDC', 'USDC', 6)) as MockTokenPermit;
    amoMinter = (await deployUpgradeable(new AMOMinter__factory(deployer))) as AMOMinter;
    await amoMinter.initialize(coreBorrow.address);
    await coreBorrow.toggleGovernor(governor);
    await coreBorrow.toggleGuardian(guardian);
  });
  describe('initializer', () => {
    it('reverts - already initialized', async () => {
      await expect(amoMinter.initialize(coreBorrow.address)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
    it('reverts - zero address', async () => {
      const amoMinter2 = (await deployUpgradeable(new AMOMinter__factory(deployer))) as AMOMinter;
      await expect(amoMinter2.initialize(ZERO_ADDRESS)).to.be.revertedWith('ZeroAddress');
    });
  });
  describe('isGovernor', () => {
    it('success - true when governor, false when not', async () => {
      expect(await amoMinter.isGovernor(governor)).to.be.equal(true);
      expect(await amoMinter.isGovernor(guardian)).to.be.equal(false);
      expect(await amoMinter.isGovernor(alice.address)).to.be.equal(false);
      expect(await amoMinter.isGovernor(bob.address)).to.be.equal(false);
      expect(await amoMinter.isGovernor(deployer.address)).to.be.equal(false);
    });
  });
  describe('isApproved', () => {
    it('success - true when governor or guardian, false when not', async () => {
      expect(await amoMinter.isApproved(governor)).to.be.equal(true);
      expect(await amoMinter.isApproved(guardian)).to.be.equal(true);
      expect(await amoMinter.isApproved(alice.address)).to.be.equal(false);
      expect(await amoMinter.isApproved(bob.address)).to.be.equal(false);
      expect(await amoMinter.isApproved(deployer.address)).to.be.equal(false);
    });
  });
  describe('addAMO', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).addAMO(alice.address)).to.be.revertedWith('NotGovernor');
    });
    it('reverts - zero address', async () => {
      await expect(amoMinter.connect(impersonatedSigners[governor]).addAMO(ZERO_ADDRESS)).to.be.revertedWith(
        'ZeroAddress',
      );
    });
    it('success - amo added', async () => {
      const receipt = await (await amoMinter.connect(impersonatedSigners[governor]).addAMO(alice.address)).wait();
      inReceipt(receipt, 'AMOAdded', {
        amo: alice.address,
      });
      expect(await amoMinter.amosWhitelist(alice.address)).to.be.equal(1);
      expect(await amoMinter.amoList(0)).to.be.equal(alice.address);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses[0]).to.be.equal(alice.address);
    });
    it('reverts - amo already added', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(alice.address);
      await expect(amoMinter.connect(impersonatedSigners[governor]).addAMO(alice.address)).to.be.revertedWith(
        'AMOAlreadyAdded',
      );
    });
  });
  describe('removeAMO', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).removeAMO(alice.address)).to.be.revertedWith('NotGovernor');
    });
    it('reverts - zero address', async () => {
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(ZERO_ADDRESS)).to.be.revertedWith(
        'ZeroAddress',
      );
    });
    it('reverts - amo non existent', async () => {
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(alice.address)).to.be.revertedWith(
        'AMONonExistent',
      );
    });
    it('success - amo removed', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(alice.address);
      const receipt = await (await amoMinter.connect(impersonatedSigners[governor]).removeAMO(alice.address)).wait();
      inReceipt(receipt, 'AMORemoved', {
        amo: alice.address,
      });
      expect(await amoMinter.amosWhitelist(alice.address)).to.be.equal(0);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses.length).to.be.equal(0);
    });
    it('success - amo removed when there are two amos and first of the list is removed', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(alice.address);
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(bob.address);
      const receipt = await (await amoMinter.connect(impersonatedSigners[governor]).removeAMO(alice.address)).wait();
      inReceipt(receipt, 'AMORemoved', {
        amo: alice.address,
      });
      expect(await amoMinter.amosWhitelist(alice.address)).to.be.equal(0);
      expect(await amoMinter.amosWhitelist(bob.address)).to.be.equal(1);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses.length).to.be.equal(1);
      expect(await amoMinter.amoList(0)).to.be.equal(bob.address);
    });
    it('success - amo removed when there are two amos and last of the list is removed', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(alice.address);
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(bob.address);
      const receipt = await (await amoMinter.connect(impersonatedSigners[governor]).removeAMO(bob.address)).wait();
      inReceipt(receipt, 'AMORemoved', {
        amo: bob.address,
      });
      expect(await amoMinter.amosWhitelist(alice.address)).to.be.equal(1);
      expect(await amoMinter.amosWhitelist(bob.address)).to.be.equal(0);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses.length).to.be.equal(1);
      expect(await amoMinter.amoList(0)).to.be.equal(alice.address);
    });
    it('success - amo removed when there are three amos and middle of the list is removed', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(alice.address);
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(bob.address);
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(deployer.address);
      const receipt = await (await amoMinter.connect(impersonatedSigners[governor]).removeAMO(bob.address)).wait();
      inReceipt(receipt, 'AMORemoved', {
        amo: bob.address,
      });
      expect(await amoMinter.amosWhitelist(alice.address)).to.be.equal(1);
      expect(await amoMinter.amosWhitelist(deployer.address)).to.be.equal(1);
      expect(await amoMinter.amosWhitelist(bob.address)).to.be.equal(0);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses.length).to.be.equal(2);
      expect(await amoMinter.amoList(0)).to.be.equal(alice.address);
      expect(await amoMinter.amoList(1)).to.be.equal(deployer.address);
    });
  });
  describe('addTokenRightToAMO', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).addTokenRightToAMO(amo.address, bob.address, 0)).to.be.revertedWith(
        'NotGovernor',
      );
    });
    it('reverts - zero address', async () => {
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).addTokenRightToAMO(amo.address, ZERO_ADDRESS, 0),
      ).to.be.revertedWith('ZeroAddress');
    });
    it('success - when non existent AMO', async () => {
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).addTokenRightToAMO(amo.address, bob.address, 0)
      ).wait();
      inReceipt(receipt, 'AMOAdded', {
        amo: amo.address,
      });
      inReceipt(receipt, 'AMORightOnTokenAdded', {
        amo: amo.address,
        token: bob.address,
      });
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: 0,
      });
      expect(await amoMinter.amosWhitelist(amo.address)).to.be.equal(1);
      expect(await amoMinter.amoList(0)).to.be.equal(amo.address);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses[0]).to.be.equal(amo.address);
      expect(await amoMinter.amosWhitelistToken(amo.address, bob.address)).to.be.equal(1);
      expect(await amoMinter.amoTokens(amo.address, 0)).to.be.equal(bob.address);
      expect(await amo.tokens(bob.address)).to.be.equal(true);
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens[0]).to.be.equal(bob.address);
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(0);
    });
    it('reverts - when token has already been added for amo', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addTokenRightToAMO(amo.address, bob.address, 0);
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).addTokenRightToAMO(amo.address, bob.address, 0),
      ).to.be.revertedWith('AMOWhitelisted');
    });
    it('reverts - when amo does not support interface', async () => {
      await expect(amoMinter.connect(impersonatedSigners[governor]).addTokenRightToAMO(alice.address, bob.address, 0))
        .to.be.reverted;
    });
    it('success - when AMO has previously been added', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      expect(await amoMinter.amosWhitelist(amo.address)).to.be.equal(1);
      expect(await amoMinter.amoList(0)).to.be.equal(amo.address);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses[0]).to.be.equal(amo.address);
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).addTokenRightToAMO(amo.address, bob.address, 0)
      ).wait();
      inReceipt(receipt, 'AMORightOnTokenAdded', {
        amo: amo.address,
        token: bob.address,
      });
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: 0,
      });
      expect(await amoMinter.amosWhitelistToken(amo.address, bob.address)).to.be.equal(1);
      expect(await amoMinter.amoTokens(amo.address, 0)).to.be.equal(bob.address);
      expect(await amo.tokens(bob.address)).to.be.equal(true);
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens[0]).to.be.equal(bob.address);
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(0);
    });
    it('success - when AMO has previously been added and non null borrow cap', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      expect(await amoMinter.amosWhitelist(amo.address)).to.be.equal(1);
      expect(await amoMinter.amoList(0)).to.be.equal(amo.address);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses[0]).to.be.equal(amo.address);
      const receipt = await (
        await amoMinter
          .connect(impersonatedSigners[governor])
          .addTokenRightToAMO(amo.address, bob.address, parseEther('1'))
      ).wait();
      inReceipt(receipt, 'AMORightOnTokenAdded', {
        amo: amo.address,
        token: bob.address,
      });
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: parseEther('1'),
      });
      expect(await amoMinter.amosWhitelistToken(amo.address, bob.address)).to.be.equal(1);
      expect(await amoMinter.amoTokens(amo.address, 0)).to.be.equal(bob.address);
      expect(await amo.tokens(bob.address)).to.be.equal(true);
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens[0]).to.be.equal(bob.address);
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(parseEther('1'));
    });
  });
  describe('removeTokenRightFromAMO', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).removeTokenRightFromAMO(amo.address, bob.address)).to.be.revertedWith(
        'NotGovernor',
      );
    });
    it('reverts - zero address', async () => {
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, ZERO_ADDRESS),
      ).to.be.revertedWith('NotWhitelisted');
    });
    it('reverts - not whitelisted', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, bob.address),
      ).to.be.revertedWith('NotWhitelisted');
    });
    it('success - token right removed from the amo when there is just one token', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, bob.address, parseEther('1'));
      expect(await amo.tokens(bob.address)).to.be.equal(true);
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, bob.address)
      ).wait();
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: parseEther('0'),
      });
      inReceipt(receipt, 'AMORightOnTokenRemoved', {
        amo: amo.address,
        token: bob.address,
      });
      expect(await amoMinter.amosWhitelistToken(amo.address, bob.address)).to.be.equal(0);
      expect(await amo.tokens(bob.address)).to.be.equal(false);
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens.length).to.be.equal(0);
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(parseEther('0'));
    });
    it('success - token right removed from the amo - two tokens and first one is removed', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, bob.address, parseEther('1'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, alice.address, parseEther('2'));
      expect(await amo.tokens(bob.address)).to.be.equal(true);
      expect(await amo.tokens(alice.address)).to.be.equal(true);
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, bob.address)
      ).wait();
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: parseEther('0'),
      });
      inReceipt(receipt, 'AMORightOnTokenRemoved', {
        amo: amo.address,
        token: bob.address,
      });
      expect(await amoMinter.amosWhitelistToken(amo.address, bob.address)).to.be.equal(0);
      expect(await amoMinter.amosWhitelistToken(amo.address, alice.address)).to.be.equal(1);
      expect(await amo.tokens(bob.address)).to.be.equal(false);
      expect(await amoMinter.amoTokens(amo.address, 0)).to.be.equal(alice.address);
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens.length).to.be.equal(1);
      expect(allAMOTokens[0]).to.be.equal(alice.address);
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(parseEther('0'));
      expect(await amoMinter.borrowCaps(amo.address, alice.address)).to.be.equal(parseEther('2'));
    });
    it('success - token right removed from the amo - two tokens and second one is removed', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, alice.address, parseEther('2'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, bob.address, parseEther('1'));
      expect(await amo.tokens(bob.address)).to.be.equal(true);
      expect(await amo.tokens(alice.address)).to.be.equal(true);
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, bob.address)
      ).wait();
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: parseEther('0'),
      });
      inReceipt(receipt, 'AMORightOnTokenRemoved', {
        amo: amo.address,
        token: bob.address,
      });
      expect(await amoMinter.amosWhitelistToken(amo.address, bob.address)).to.be.equal(0);
      expect(await amoMinter.amosWhitelistToken(amo.address, alice.address)).to.be.equal(1);
      expect(await amo.tokens(bob.address)).to.be.equal(false);
      expect(await amoMinter.amoTokens(amo.address, 0)).to.be.equal(alice.address);
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens.length).to.be.equal(1);
      expect(allAMOTokens[0]).to.be.equal(alice.address);
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(parseEther('0'));
      expect(await amoMinter.borrowCaps(amo.address, alice.address)).to.be.equal(parseEther('2'));
    });
    it('success - token right removed from the amo - three tokens and middle one is removed', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, alice.address, parseEther('2'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, bob.address, parseEther('1'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, deployer.address, parseEther('4'));
      expect(await amo.tokens(bob.address)).to.be.equal(true);
      expect(await amo.tokens(alice.address)).to.be.equal(true);
      expect(await amo.tokens(deployer.address)).to.be.equal(true);
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, bob.address)
      ).wait();
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: parseEther('0'),
      });
      inReceipt(receipt, 'AMORightOnTokenRemoved', {
        amo: amo.address,
        token: bob.address,
      });
      expect(await amoMinter.amosWhitelistToken(amo.address, bob.address)).to.be.equal(0);
      expect(await amoMinter.amosWhitelistToken(amo.address, alice.address)).to.be.equal(1);
      expect(await amoMinter.amosWhitelistToken(amo.address, deployer.address)).to.be.equal(1);
      expect(await amo.tokens(bob.address)).to.be.equal(false);
      expect(await amo.tokens(alice.address)).to.be.equal(true);
      expect(await amo.tokens(deployer.address)).to.be.equal(true);
      expect(await amoMinter.amoTokens(amo.address, 0)).to.be.equal(alice.address);
      expect(await amoMinter.amoTokens(amo.address, 1)).to.be.equal(deployer.address);
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens.length).to.be.equal(2);
      expect(allAMOTokens[0]).to.be.equal(alice.address);
      expect(allAMOTokens[1]).to.be.equal(deployer.address);
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(parseEther('0'));
      expect(await amoMinter.borrowCaps(amo.address, alice.address)).to.be.equal(parseEther('2'));
      expect(await amoMinter.borrowCaps(amo.address, deployer.address)).to.be.equal(parseEther('4'));
    });
  });
  describe('allAMOAddresses', () => {
    it('success - empty when no AMO', async () => {
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses.length).to.be.equal(0);
    });
    it('success - when there are several AMOs', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(alice.address);
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(bob.address);
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(deployer.address);
      const allAMOAddresses = await amoMinter.allAMOAddresses();
      expect(allAMOAddresses.length).to.be.equal(3);
      expect(allAMOAddresses[0]).to.be.equal(alice.address);
      expect(allAMOAddresses[1]).to.be.equal(bob.address);
      expect(allAMOAddresses[2]).to.be.equal(deployer.address);
    });
  });
  describe('allAMOTokens', () => {
    it('success - empty when no AMO', async () => {
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens.length).to.be.equal(0);
    });
    it('success - when there are several AMOs', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, alice.address, parseEther('2'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, bob.address, parseEther('1'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, deployer.address, parseEther('4'));
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens.length).to.be.equal(3);
      expect(allAMOTokens[0]).to.be.equal(alice.address);
      expect(allAMOTokens[1]).to.be.equal(bob.address);
      expect(allAMOTokens[2]).to.be.equal(deployer.address);
    });
  });
  describe('toggleCallerToAMO', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).toggleCallerToAMO(amo.address, bob.address)).to.be.revertedWith(
        'NotGovernor',
      );
    });
    it('reverts - zero address', async () => {
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).toggleCallerToAMO(amo.address, ZERO_ADDRESS),
      ).to.be.revertedWith('ZeroAddress');
    });
    it('reverts - non existent amo', async () => {
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).toggleCallerToAMO(amo.address, alice.address),
      ).to.be.revertedWith('AMONonExistent');
    });
    it('success - caller approved', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      await amoMinter.connect(impersonatedSigners[governor]).toggleCallerToAMO(amo.address, alice.address);
      expect(await amoMinter.amosWhitelistCaller(amo.address, alice.address)).to.be.equal(1);
      expect(await amo.isApproved(amoMinter.address, alice.address)).to.be.equal(true);
    });
    it('success - caller approved and disapproved', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      await amoMinter.connect(impersonatedSigners[governor]).toggleCallerToAMO(amo.address, alice.address);
      expect(await amoMinter.amosWhitelistCaller(amo.address, alice.address)).to.be.equal(1);
      expect(await amo.isApproved(amoMinter.address, alice.address)).to.be.equal(true);
      await amoMinter.connect(impersonatedSigners[governor]).toggleCallerToAMO(amo.address, alice.address);
      expect(await amoMinter.amosWhitelistCaller(amo.address, alice.address)).to.be.equal(0);
      expect(await amo.isApproved(amoMinter.address, alice.address)).to.be.equal(false);
    });
  });
  describe('setBorrowCap', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).setBorrowCap(amo.address, bob.address, 0)).to.be.revertedWith(
        'NotGovernor',
      );
    });
    it('reverts - amo not whitelisted', async () => {
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).setBorrowCap(amo.address, bob.address, 0),
      ).to.be.revertedWith('NotWhitelisted');
    });
    it('success - borrow cap updated', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addTokenRightToAMO(amo.address, bob.address, 0);
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).setBorrowCap(amo.address, bob.address, parseEther('10'))
      ).wait();
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: parseEther('10'),
      });
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(parseEther('10'));
    });
    it('success - borrow cap updated and then reinitialized', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addTokenRightToAMO(amo.address, bob.address, 0);
      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).setBorrowCap(amo.address, bob.address, parseEther('10'))
      ).wait();
      inReceipt(receipt, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: parseEther('10'),
      });
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(parseEther('10'));
      const receipt2 = await (
        await amoMinter.connect(impersonatedSigners[governor]).setBorrowCap(amo.address, bob.address, parseEther('7'))
      ).wait();
      inReceipt(receipt2, 'BorrowCapUpdated', {
        amo: amo.address,
        token: bob.address,
        borrowCap: parseEther('7'),
      });
      expect(await amoMinter.borrowCaps(amo.address, bob.address)).to.be.equal(parseEther('7'));
    });
  });
  describe('setCoreBorrow', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.setCoreBorrow(alice.address)).to.be.revertedWith('NotGovernor');
    });
    it('reverts - invalid core contract', async () => {
      const coreBorrowNew = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).setCoreBorrow(coreBorrowNew.address),
      ).to.be.revertedWith('NotGovernor');
    });
    it('success - value updated', async () => {
      const coreBorrowNew = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
      await coreBorrowNew.toggleGovernor(governor);

      const receipt = await (
        await amoMinter.connect(impersonatedSigners[governor]).setCoreBorrow(coreBorrowNew.address)
      ).wait();
      inReceipt(receipt, 'CoreBorrowUpdated', {
        _coreBorrow: coreBorrowNew.address,
      });
    });
  });
  describe('setAMOMinter', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).setAMOMinter(bob.address)).to.be.revertedWith('NotGovernor');
    });
    it('reverts - zero address', async () => {
      await expect(amoMinter.connect(impersonatedSigners[governor]).setAMOMinter(ZERO_ADDRESS)).to.be.revertedWith(
        'ZeroAddress',
      );
    });
    it('success - no amo - does nothing', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).setAMOMinter(bob.address);
    });
    it('success - amoMinter set', async () => {
      await amoMinter.connect(impersonatedSigners[governor]).addAMO(amo.address);
      const receipt = await (await amoMinter.connect(impersonatedSigners[governor]).setAMOMinter(bob.address)).wait();
      inReceipt(receipt, 'AMOMinterUpdated', {
        _amoMinter: bob.address,
      });
      expect(await amo.amoMinter()).to.be.equal(bob.address);
    });
  });
  describe('recoverERC20', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).recoverERC20(alice.address, bob.address, 0)).to.be.revertedWith(
        'NotGovernor',
      );
    });
    it('success - funds recovered', async () => {
      await tokenA.mint(amoMinter.address, parseEther('1000'));
      const receipt = await (
        await amoMinter
          .connect(impersonatedSigners[governor])
          .recoverERC20(tokenA.address, bob.address, parseEther('7'))
      ).wait();
      inReceipt(receipt, 'Recovered', {
        tokenAddress: tokenA.address,
        to: bob.address,
        amountToRecover: parseEther('7'),
      });
      expect(await tokenA.balanceOf(bob.address)).to.be.equal(parseEther('7'));
    });
    it('reverts - recovered is greater than balance', async () => {
      await tokenA.mint(amoMinter.address, parseEther('1000'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).recoverERC20(tokenA.address, bob.address, parseEther('1001')),
      ).to.be.reverted;
    });
  });
  describe('execute', () => {
    it('reverts - non governor', async () => {
      await expect(amoMinter.connect(alice).execute(alice.address, '0x')).to.be.revertedWith('NotGovernor');
    });
    it('success - execute transaction', async () => {
      const receipt = await tokenA.mint(alice.address, parseEther('1000'));
      const data = receipt.data;
      await amoMinter.connect(impersonatedSigners[governor]).execute(tokenA.address, data);
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('2000'));
    });
  });
  describe('sendToAMO', () => {
    it('reverts - not approved', async () => {
      await expect(amoMinter.connect(alice).sendToAMO(alice.address, [], [], [], [])).to.be.revertedWith(
        'NotApprovedCaller',
      );
    });
    it('reverts - incompatible lengths', async () => {
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).sendToAMO(alice.address, [], [], [], []),
      ).to.be.revertedWith('IncompatibleLengths');
      await expect(
        amoMinter
          .connect(impersonatedSigners[governor])
          .sendToAMO(alice.address, [alice.address], [true, false], [1, 0], []),
      ).to.be.revertedWith('IncompatibleLengths');
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).sendToAMO(alice.address, [alice.address], [false], [1, 0], []),
      ).to.be.revertedWith('IncompatibleLengths');
    });
    it('reverts - no rights on token', async () => {
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).sendToAMO(alice.address, [alice.address], [false], [0], []),
      ).to.be.revertedWith('NoRightsOnToken');
    });
    it('reverts - borrow cap reached', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('2'));
      await expect(
        amoMinter
          .connect(impersonatedSigners[governor])
          .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('4')], []),
      ).to.be.revertedWith('BorrowCapReached');
    });
    it('success - if the asset is a stablecoin', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('4'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('4')], []);
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('4'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('4'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('4'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
    it('success - if the asset is not a stablecoin', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('4'));
      await tokenA.mint(amoMinter.address, parseEther('4'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('4')], []);
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('4'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('4'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('4'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
    it('success - mix of stablecoin and not with the same amo', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('100'));
      await tokenA.mint(amoMinter.address, parseEther('100'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amo.address,
          [tokenA.address, tokenA.address, tokenA.address, tokenA.address],
          [true, false, false, true],
          [parseEther('4'), parseEther('3'), parseEther('2'), parseEther('7')],
          [],
        );
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('16'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('16'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('16'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
    it('success - mix of stablecoin and not with different amos', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('100'));
      await tokenA.mint(amoMinter.address, parseEther('100'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amo.address,
          [tokenA.address, tokenA.address, tokenA.address, tokenA.address],
          [true, false, false, true],
          [parseEther('4'), parseEther('3'), parseEther('2'), parseEther('7')],
          [],
        );
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('16'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('16'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('16'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
    it('success - mix of stablecoin and not with different amos from an approved address for this AMO', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('100'));
      await amoMinter.connect(impersonatedSigners[governor]).toggleCallerToAMO(amo.address, alice.address);
      await tokenA.mint(amoMinter.address, parseEther('100'));
      await amoMinter
        .connect(alice)
        .sendToAMO(
          amo.address,
          [tokenA.address, tokenA.address, tokenA.address, tokenA.address],
          [true, false, false, true],
          [parseEther('4'), parseEther('3'), parseEther('2'), parseEther('7')],
          [],
        );
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('16'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('16'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('16'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
  });
  describe('callerDebt', () => {
    it('success - returns 0 if called from another address', async () => {
      expect(await amoMinter.connect(alice).callerDebt(alice.address)).to.be.equal(0);
    });
    it('success - returns non null amount if called from an amo which has a debt', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('4'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('4')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenB.address, parseEther('4'));
      expect(await amo.connect(alice).callerDebt(amoMinter.address, tokenA.address)).to.be.equal(parseEther('4'));
      expect(await amo.connect(alice).callerDebt(amoMinter.address, tokenB.address)).to.be.equal(parseEther('0'));
    });
    it('success - works with different AMOs and different token debts', async () => {
      const amoB = (await new MockAMO__factory(deployer).deploy()) as MockAMO;
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('4'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenB.address, parseEther('3'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amoB.address, tokenA.address, parseEther('2'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amoB.address, tokenB.address, parseEther('1'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address, tokenB.address], [true, true], [parseEther('4'), parseEther('3')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amoB.address,
          [tokenA.address, tokenB.address],
          [true, true],
          [parseEther('2'), parseEther('1')],
          [],
        );

      expect(await amo.connect(alice).callerDebt(amoMinter.address, tokenA.address)).to.be.equal(parseEther('4'));
      expect(await amo.connect(alice).callerDebt(amoMinter.address, tokenB.address)).to.be.equal(parseEther('3'));
      expect(await amoB.connect(alice).callerDebt(amoMinter.address, tokenA.address)).to.be.equal(parseEther('2'));
      expect(await amoB.connect(alice).callerDebt(amoMinter.address, tokenB.address)).to.be.equal(parseEther('1'));
    });
  });
  describe('receiveFromAMO', () => {
    it('reverts - not approved', async () => {
      await expect(amoMinter.connect(alice).receiveFromAMO(alice.address, [], [], [], [], [])).to.be.revertedWith(
        'NotApprovedCaller',
      );
    });
    it('reverts - incompatible lengths', async () => {
      await expect(
        amoMinter
          .connect(impersonatedSigners[governor])
          .receiveFromAMO(alice.address, [alice.address, bob.address], [true], [1], [ZERO_ADDRESS], []),
      ).to.be.revertedWith('IncompatibleLengths');
      await expect(
        amoMinter
          .connect(impersonatedSigners[governor])
          .receiveFromAMO(alice.address, [alice.address], [true, false], [1], [ZERO_ADDRESS], []),
      ).to.be.revertedWith('IncompatibleLengths');
      await expect(
        amoMinter
          .connect(impersonatedSigners[governor])
          .receiveFromAMO(alice.address, [alice.address], [true], [1, 0], [ZERO_ADDRESS], []),
      ).to.be.revertedWith('IncompatibleLengths');
      await expect(
        amoMinter
          .connect(impersonatedSigners[governor])
          .receiveFromAMO(alice.address, [alice.address], [true], [0], [ZERO_ADDRESS, ZERO_ADDRESS], []),
      ).to.be.revertedWith('IncompatibleLengths');
    });
    it('reverts - no rights on token', async () => {
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).sendToAMO(alice.address, [alice.address], [false], [0], []),
      ).to.be.reverted;
    });
    it('reverts - amount bigger than AMODebt', async () => {
      await tokenA.mint(amo.address, parseEther('100'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await expect(
        amoMinter
          .connect(impersonatedSigners[governor])
          .receiveFromAMO(amo.address, [alice.address], [false], [parseEther('10')], [alice.address], []),
      ).to.be.reverted;
    });
    it('reverts - when amo does not have the interface', async () => {
      await expect(
        amoMinter
          .connect(impersonatedSigners[governor])
          .receiveFromAMO(alice.address, [alice.address], [false], [parseEther('10')], [alice.address], []),
      ).to.be.reverted;
    });
    it('success - amount pulled from the AMO if it is not stablecoin', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('4')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(amo.address, [tokenA.address], [false], [parseEther('3')], [alice.address], []);
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('1'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('1'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('1'));
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
    it('success - amount pulled from the AMO if it is not stablecoin and less is available than the debt', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('5')], []);
      // Only 1 will be withdrawable in this case
      await tokenA.burn(amo.address, parseEther('3'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(amo.address, [tokenA.address], [false], [parseEther('4')], [alice.address], []);
      // Only able to reimburse 2, so 3 of debt is leftover
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('3'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('1'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('0'));
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('2'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
    it('success - amount pulled from the AMO if it is not stablecoin and called by approved address', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter.connect(impersonatedSigners[governor]).toggleCallerToAMO(amo.address, alice.address);
      await amoMinter.connect(alice).sendToAMO(amo.address, [tokenA.address], [true], [parseEther('4')], []);
      await amoMinter
        .connect(alice)
        .receiveFromAMO(amo.address, [tokenA.address], [false], [parseEther('3')], [alice.address], []);
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('1'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('1'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('1'));
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('3'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
    it('success - amount pulled from the AMO if it is a stablecoin', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('4')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(amo.address, [tokenA.address], [true], [parseEther('3')], [alice.address], []);
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('1'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('1'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('1'));
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('0'));
      await expect(
        amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address),
      ).to.be.revertedWith('AMOTokenDebtNotRepaid');
      await expect(amoMinter.connect(impersonatedSigners[governor]).removeAMO(amo.address)).to.be.revertedWith(
        'SupportedTokensNotRemoved',
      );
    });
    it('success - full amount pulled from the AMO and AMO can be removed', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('4')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(amo.address, [tokenA.address], [false], [parseEther('4')], [alice.address], []);
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('0'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('0'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('0'));
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('4'));
      await amoMinter.connect(impersonatedSigners[governor]).removeTokenRightFromAMO(amo.address, tokenA.address);
      const allAMOTokens = await amoMinter.allAMOTokens(amo.address);
      expect(allAMOTokens.length).to.be.equal(0);
    });
    it('success - different tokens appearing multiple times', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenB.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('100')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenB.address], [true], [parseEther('100')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(
          amo.address,
          [tokenA.address, tokenA.address, tokenB.address, tokenA.address, tokenB.address],
          [false, true, false, true, true],
          [parseEther('4'), parseEther('2'), parseEther('3'), parseEther('5'), parseEther('6')],
          [alice.address, bob.address, deployer.address, governor, guardian],
          [],
        );
      // Repay 4 + 2 + 5 = 11 for token A
      // Repay 3 + 6 for token B
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('89'));
      expect(await amo.tokenAmounts(tokenA.address)).to.be.equal(parseEther('89'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('89'));
      expect(await amoMinter.amoDebts(amo.address, tokenB.address)).to.be.equal(parseEther('91'));
      expect(await amo.tokenAmounts(tokenB.address)).to.be.equal(parseEther('91'));
      expect(await tokenB.balanceOf(amo.address)).to.be.equal(parseEther('91'));
      // Balance is not updated when token is a stablecoin
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('4'));
      expect(await tokenA.balanceOf(bob.address)).to.be.equal(parseEther('0'));
      expect(await tokenB.balanceOf(deployer.address)).to.be.equal(parseEther('3'));
      expect(await tokenA.balanceOf(governor)).to.be.equal(parseEther('0'));
      expect(await tokenB.balanceOf(guardian)).to.be.equal(parseEther('0'));
    });
    it('success - different tokens appearing multiple times but with sometimes losses on the tokens', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenB.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('100')], []);
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenB.address], [true], [parseEther('100')], []);
      await tokenA.burn(amo.address, parseEther('95'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .receiveFromAMO(
          amo.address,
          [tokenA.address, tokenB.address, tokenB.address],
          [false, true, false],
          [parseEther('6'), parseEther('4'), parseEther('3')],
          [alice.address, bob.address, deployer.address],
          [],
        );
      // Repay 4 + 2 + 5 = 11 for token A
      // Repay 3 + 6 for token B
      // Only able to withdraw 1
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('95'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('0'));
      expect(await amoMinter.amoDebts(amo.address, tokenB.address)).to.be.equal(parseEther('93'));
      expect(await tokenB.balanceOf(amo.address)).to.be.equal(parseEther('93'));
      // Balance is not updated when token is a stablecoin: and in the first transfer it's a stablecoin
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('5'));
      expect(await tokenB.balanceOf(bob.address)).to.be.equal(parseEther('0'));
      expect(await tokenB.balanceOf(deployer.address)).to.be.equal(parseEther('3'));
    });
  });

  describe('repayDebtFor', () => {
    it('reverts - incompatible lengths', async () => {
      await expect(amoMinter.connect(alice).repayDebtFor([], [], [])).to.be.revertedWith('IncompatibleLengths');
      await expect(amoMinter.connect(alice).repayDebtFor([alice.address], [bob.address], [0, 0])).to.be.revertedWith(
        'IncompatibleLengths',
      );
      await expect(
        amoMinter.connect(alice).repayDebtFor([alice.address], [bob.address, alice.address], [0]),
      ).to.be.revertedWith('IncompatibleLengths');
      await expect(
        amoMinter.connect(alice).repayDebtFor([alice.address, alice.address], [bob.address], [0]),
      ).to.be.revertedWith('IncompatibleLengths');
    });
    it('reverts - invalid AMO or no approval', async () => {
      await tokenA.mint(alice.address, parseEther('100'));
      await expect(amoMinter.connect(alice).repayDebtFor([alice.address], [bob.address], [parseEther('1')])).to.be
        .reverted;
      await tokenA.connect(alice).approve(amoMinter.address, parseEther('100'));
      await expect(amoMinter.connect(alice).repayDebtFor([alice.address], [bob.address], [parseEther('1')])).to.be
        .reverted;
    });
    it('success - amo with debt in it', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(amo.address, [tokenA.address], [true], [parseEther('100')], []);
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('100'));
      await tokenA.mint(alice.address, parseEther('50'));
      await tokenA.connect(alice).approve(amoMinter.address, parseEther('100'));
      await amoMinter.connect(alice).repayDebtFor([amo.address], [tokenA.address], [parseEther('1')]);
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('99'));
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('49'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('100'));
    });
    it('success - multiple amos and multiple tokens', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenB.address, parseEther('1000'));
      const amoB = (await new MockAMO__factory(deployer).deploy()) as MockAMO;
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amoB.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amoB.address, tokenB.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amo.address,
          [tokenA.address, tokenB.address],
          [true, true],
          [parseEther('100'), parseEther('60')],
          [],
        );
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amoB.address,
          [tokenA.address, tokenB.address],
          [true, true],
          [parseEther('40'), parseEther('30')],
          [],
        );
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('100'));
      expect(await amoMinter.amoDebts(amo.address, tokenB.address)).to.be.equal(parseEther('60'));
      expect(await amoMinter.amoDebts(amoB.address, tokenA.address)).to.be.equal(parseEther('40'));
      expect(await amoMinter.amoDebts(amoB.address, tokenB.address)).to.be.equal(parseEther('30'));
      await tokenA.mint(alice.address, parseEther('50'));
      await tokenB.mint(alice.address, parseEther('10'));
      await tokenA.connect(alice).approve(amoMinter.address, parseEther('100'));
      await tokenB.connect(alice).approve(amoMinter.address, parseEther('100'));
      await amoMinter
        .connect(alice)
        .repayDebtFor(
          [amo.address, amo.address, amoB.address, amoB.address],
          [tokenA.address, tokenB.address, tokenA.address, tokenB.address],
          [parseEther('1'), parseEther('2'), parseEther('3'), parseEther('4')],
        );
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('99'));
      expect(await amoMinter.amoDebts(amo.address, tokenB.address)).to.be.equal(parseEther('58'));
      expect(await amoMinter.amoDebts(amoB.address, tokenA.address)).to.be.equal(parseEther('37'));
      expect(await amoMinter.amoDebts(amoB.address, tokenB.address)).to.be.equal(parseEther('26'));
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('46'));
      expect(await tokenB.balanceOf(alice.address)).to.be.equal(parseEther('4'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('100'));
      expect(await tokenB.balanceOf(amo.address)).to.be.equal(parseEther('60'));
      expect(await tokenA.balanceOf(amoB.address)).to.be.equal(parseEther('40'));
      expect(await tokenB.balanceOf(amoB.address)).to.be.equal(parseEther('30'));
    });
    it('success - multiple amos and multiple tokens several times on the amo', async () => {
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amo.address, tokenB.address, parseEther('1000'));
      const amoB = (await new MockAMO__factory(deployer).deploy()) as MockAMO;
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amoB.address, tokenA.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .addTokenRightToAMO(amoB.address, tokenB.address, parseEther('1000'));
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amo.address,
          [tokenA.address, tokenB.address],
          [true, true],
          [parseEther('100'), parseEther('60')],
          [],
        );
      await amoMinter
        .connect(impersonatedSigners[governor])
        .sendToAMO(
          amoB.address,
          [tokenA.address, tokenB.address],
          [true, true],
          [parseEther('40'), parseEther('30')],
          [],
        );
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('100'));
      expect(await amoMinter.amoDebts(amo.address, tokenB.address)).to.be.equal(parseEther('60'));
      expect(await amoMinter.amoDebts(amoB.address, tokenA.address)).to.be.equal(parseEther('40'));
      expect(await amoMinter.amoDebts(amoB.address, tokenB.address)).to.be.equal(parseEther('30'));
      await tokenA.mint(alice.address, parseEther('50'));
      await tokenB.mint(alice.address, parseEther('10'));
      await tokenA.connect(alice).approve(amoMinter.address, parseEther('100'));
      await tokenB.connect(alice).approve(amoMinter.address, parseEther('100'));
      await amoMinter
        .connect(alice)
        .repayDebtFor(
          [amo.address, amo.address, amoB.address, amoB.address, amo.address],
          [tokenA.address, tokenB.address, tokenA.address, tokenB.address, tokenA.address],
          [parseEther('1'), parseEther('2'), parseEther('3'), parseEther('4'), parseEther('10')],
        );
      expect(await amoMinter.amoDebts(amo.address, tokenA.address)).to.be.equal(parseEther('89'));
      expect(await amoMinter.amoDebts(amo.address, tokenB.address)).to.be.equal(parseEther('58'));
      expect(await amoMinter.amoDebts(amoB.address, tokenA.address)).to.be.equal(parseEther('37'));
      expect(await amoMinter.amoDebts(amoB.address, tokenB.address)).to.be.equal(parseEther('26'));
      expect(await tokenA.balanceOf(alice.address)).to.be.equal(parseEther('36'));
      expect(await tokenB.balanceOf(alice.address)).to.be.equal(parseEther('4'));
      expect(await tokenA.balanceOf(amo.address)).to.be.equal(parseEther('100'));
      expect(await tokenB.balanceOf(amo.address)).to.be.equal(parseEther('60'));
      expect(await tokenA.balanceOf(amoB.address)).to.be.equal(parseEther('40'));
      expect(await tokenB.balanceOf(amoB.address)).to.be.equal(parseEther('30'));
    });
  });
});
