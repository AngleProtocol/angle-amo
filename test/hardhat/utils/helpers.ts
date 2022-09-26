import { BigNumber, BigNumberish, Contract, ContractFactory, Signer, utils } from 'ethers';
import { parseUnits } from 'ethers/lib/utils';
import hre, { ethers, network } from 'hardhat';

import { ERC20, ERC20__factory, TransparentUpgradeableProxy__factory } from '../../../typechain';
import { expect } from '../utils/chai-setup';

const BASE_PARAMS = parseUnits('1', 'gwei');

async function getImpersonatedSigner(address: string): Promise<Signer> {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });

  const signer = await ethers.getSigner(address);

  return signer;
}

async function increaseTime(amount: number | string | BigNumberish): Promise<void> {
  await time.increase(amount);
}

async function resetTime(): Promise<void> {
  await resetFork();
}

async function resetFork(): Promise<void> {
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: hre.config.networks.hardhat.forking
          ? {
              jsonRpcUrl: hre.config.networks.hardhat.forking.url,
            }
          : undefined,
      },
    ],
  });
}

async function setNextBlockTimestamp(time: number): Promise<void> {
  await hre.network.provider.request({
    method: 'evm_setNextBlockTimestamp',
    params: [time],
  });
}

async function latestTime(): Promise<number> {
  const { timestamp } = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());

  return timestamp as number;
}

async function mine(): Promise<void> {
  await hre.network.provider.request({
    method: 'evm_mine',
  });
}

const ZERO_ADDRESS = ethers.constants.AddressZero;
const MAX_UINT256 = ethers.constants.MaxUint256;

const balance = {
  current: async (address: string): Promise<BigNumber> => {
    const balance = await ethers.provider.getBalance(address);
    return balance;
  },
};

const time = {
  latest: async (): Promise<number> => latestTime(),

  latestBlock: async (): Promise<number> => await ethers.provider.getBlockNumber(),

  increase: async (duration: number | string | BigNumberish): Promise<void> => {
    const durationBN = ethers.BigNumber.from(duration);

    if (durationBN.lt(ethers.constants.Zero)) throw Error(`Cannot increase time by a negative amount (${duration})`);

    await hre.network.provider.send('evm_increaseTime', [durationBN.toNumber()]);

    await hre.network.provider.send('evm_mine');
  },

  increaseTo: async (target: number | string | BigNumberish): Promise<void> => {
    const targetBN = ethers.BigNumber.from(target);

    const now = ethers.BigNumber.from(await time.latest());

    if (targetBN.lt(now)) throw Error(`Cannot increase current time (${now}) to a moment in the past (${target})`);
    const diff = targetBN.sub(now);
    return time.increase(diff);
  },

  advanceBlockTo: async (target: number | string | BigNumberish): Promise<void> => {
    target = ethers.BigNumber.from(target);

    const currentBlock = await time.latestBlock();
    const start = Date.now();
    let notified;
    if (target.lt(currentBlock))
      throw Error(`Target block #(${target}) is lower than current block #(${currentBlock})`);
    while (ethers.BigNumber.from(await time.latestBlock()).lt(target)) {
      if (!notified && Date.now() - start >= 5000) {
        notified = true;
        console.warn("You're advancing many blocks; this test may be slow.");
      }
      await time.advanceBlock();
    }
  },

  advanceBlock: async (): Promise<void> => {
    await hre.network.provider.send('evm_mine');
  },
};

// eslint-disable-next-line
async function deployUpgradeable(factory: ContractFactory, ...args: any[]): Promise<Contract> {
  const { deployer, proxyAdmin, alice } = await ethers.getNamedSigners();

  const Implementation = args.length === 0 ? await factory.deploy() : await factory.deploy(args[0], args[1]);
  const Proxy = await new TransparentUpgradeableProxy__factory(deployer).deploy(
    Implementation.address,
    proxyAdmin.address,
    '0x',
  );

  return new Contract(Proxy.address, factory.interface, alice);
}

async function deploy(
  contractName: string,
  // eslint-disable-next-line
  args: any[] = [],
  // eslint-disable-next-line
  options: Record<string, any> & { libraries?: Record<string, string> } = {},
): Promise<Contract> {
  const factory = await ethers.getContractFactory(contractName, options);
  const contract = await factory.deploy(...args);
  return contract;
}

async function expectApproxDelta(actual: BigNumber, expected: BigNumber, delta: BigNumber): Promise<void> {
  const margin = expected.div(delta);
  if (actual.isNegative()) {
    expect(expected.gte(actual.add(margin))).to.be.true;
    expect(expected.lte(actual.sub(margin))).to.be.true;
  } else {
    expect(expected.lte(actual.add(margin))).to.be.true;
    expect(expected.gte(actual.sub(margin))).to.be.true;
  }
}

function expectApprox(value: BigNumberish, target: BigNumberish, error: number): void {
  expect(value).to.be.lt(
    BigNumber.from(target)
      .mul((100 + error) * 1e10)
      .div(100 * 1e10),
  );
  expect(value).to.be.gt(
    BigNumber.from(target)
      .mul((100 - error) * 1e10)
      .div(100 * 1e10),
  );
}

export async function findBalancesSlot(tokenAddress: string): Promise<number> {
  // eslint-disable-next-line
  const encode = (types: string[], values: any[]) => ethers.utils.defaultAbiCoder.encode(types, values);
  const account = ethers.constants.AddressZero;
  const probeA = encode(['uint'], [1]);
  const probeB = encode(['uint'], [2]);
  const token = await ethers.getContractAt('ERC20', tokenAddress);
  for (let i = 0; i < 100; i++) {
    let probedSlot = ethers.utils.keccak256(encode(['address', 'uint'], [account, i]));
    // remove padding for JSON RPC
    while (probedSlot.startsWith('0x0')) probedSlot = '0x' + probedSlot.slice(3);
    const prev = await network.provider.send('eth_getStorageAt', [tokenAddress, probedSlot, 'latest']);
    // make sure the probe will change the slot value
    const probe = prev === probeA ? probeB : probeA;

    await network.provider.send('hardhat_setStorageAt', [tokenAddress, probedSlot, probe]);

    const balance = await token.balanceOf(account);
    // reset to previous value
    await network.provider.send('hardhat_setStorageAt', [tokenAddress, probedSlot, prev]);
    if (balance.eq(ethers.BigNumber.from(probe))) return i;
  }
  throw Error('Balances slot not found!');
}

export async function setTokenBalanceFor(tokenAddress: string, account: string, amount: BigNumberish, balanceSlot = 0) {
  // const balanceSlot = await findBalancesSlot(token.address);
  const token = (await ethers.getContractAt(ERC20__factory.abi, tokenAddress)) as ERC20;
  const balanceStorage = utils.solidityKeccak256(['uint256', 'uint256'], [account, balanceSlot]).replace('0x0', '0x');
  const amountStorage = utils.hexZeroPad(utils.parseUnits(amount.toString(), await token.decimals()).toHexString(), 32);

  await network.provider.send('hardhat_setStorageAt', [token.address, balanceStorage, amountStorage]);
}

export {
  balance,
  BASE_PARAMS,
  deploy,
  deployUpgradeable,
  expectApprox,
  expectApproxDelta,
  getImpersonatedSigner,
  increaseTime,
  latestTime,
  MAX_UINT256,
  mine,
  resetFork,
  resetTime,
  setNextBlockTimestamp,
  time,
  ZERO_ADDRESS,
};
