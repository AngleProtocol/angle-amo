# <img src="logo.svg" alt="Angle Algorithmic Market Operations" height="40px"> Angle Algorithmic Market Operations

[![CI](https://github.com/AngleProtocol/AMO/workflows/CI/badge.svg)](https://github.com/AngleProtocol/AMO/actions?query=workflow%3ACI)
[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.angle.money/other-aspects/amo)
[![Developers](https://img.shields.io/badge/developers-%F0%9F%93%84-pink)](https://developers.angle.money)

## Documentation

Algorithmic market operations (or AMOs) are operations performed by contracts to mint or burn stablecoins without collateral immediately backing these stablecoins. The idea is that stablecoins minted by AMOs are still controlled by the protocol, and if other people start controlling these stablecoins, then this new supply should be properly backed in one way or another.
AMOs are thought not to affect the peg of the stablecoin.

We dedicated this repository to track all operations and keep an accountability book on all AMO made by the protocol.

The first deployed AMO is on the Curve pool agEUR-EUROC, and staking on both Stake DAO and Convex.

### To Start With

Angle is a decentralized stablecoin protocol, designed to be both over-collateralized and capital-efficient. For more information about the protocol, you can refer to [Angle Documentation](https://docs.angle.money).

The protocol is made of different modules, each with their own set of smart contracts. This repo contains the smart contracts for the Algorithmic Market Operations (AMOs) of the protocol that allow the protocol to mint stablecoins in some specific places in DeFi.

Documentation to understand Angle Protocol's AMOs is available [here](https://docs.angle.money/other-aspects/amo).

### Further Information

For a broader overview of the protocol and its different modules, you can also check [this overview page](https://developers.angle.money) of our developers documentation.

Other Angle-related smart contracts can be found in the following repositories:

- [Angle Core module contracts](https://github.com/AngleProtocol/angle-core)
- [Angle Strategies](https://github.com/AngleProtocol/angle-strategies)
- [Angle Borrowing module contracts](https://github.com/AngleProtocol/angle-borrow)

Otherwise, for more info about the protocol, check out [this portal](https://linktr.ee/angleprotocol) of resources.

## Setup

To install all the packages needed to run the tests, run:
`yarn`

### Setup environment

Create a `.env` file from the template file `.env.example`.
If you don't define URI and mnemonics, default mnemonic will be used with a brand new local hardhat node.

### Setup Development Toolbox

Tests and scripts on this repo are written use either Hardhat or Foundry development toolbox.

To setup Foundry on this repo, simply run:

```shell
yarn foundry:setup
```

### Compilation

With Hardhat:

```shell
yarn compile
```

With Foundry:

```shell
forge build
```

### Testing

#### Hardhat

```shell
yarn test
```

Defaults with `hardhat` network, but another network can be specified with `--network NETWORK_NAME`.

A single test file or a glob pattern can be appended to launch a reduced set of tests:

```shell
yarn test tests/vaultManager/*
```

#### Foundry

```shell
yarn test
```

A single test file or a glob pattern can be appended to launch a reduced set of tests:

```shell
forge test --match-contract MarketplaceTest --match-test testTransferOrder -vvv
```

### Scripts

Some scripts require to fork mainnet. To do so, you must first ensure that the `ETH_NODE_URI_FORK` in `.env` is pointing to an archival node (note: Alchemy provides this functionnality for free but Infura doesn't).

Then, uncomment `blockNumber` in the `hardhat` network definition inside `hardhat.config.ts` to boost node speed.
Then run:

```shell
FORK=true yarn hardhat run PATH_TO_SCRIPT
```

### Coverage

We try to keep our contract's code coverage above 99% (on Foundry and on Hardhat). All contract code additions should be covered by tests (locally and in mainnet-fork) before being merged and deployed on mainnet.

To run code coverage with Hardhat tests:

```shell
yarn coverage
```

A subgroup of tests can be run by specifying `--testfiles "path/to/tests/*.ts"`.

If coverage runs out of memory, you can export this in your env and retry:

```shell
export NODE_OPTIONS=--max_old_space_size=4096
```

With Foundry, run:

```shell
yarn coverage:foundry
```

### Troubleshooting

If you have issues running tests or scripts, you can try to regenerate contracts typescript bindings by running

```shell
yarn generate-types-from-abis
```

You can also delete `node_modules`, `cache`, and then re-install dependancies with `yarn install --frozen-lockfile`.

## Bug Bounty

At Angle, we consider the security of our systems a top priority. But even putting top priority status and maximum effort, there is still possibility that vulnerabilities exist.

We have therefore setup a bug bounty program with the help of Immunefi. The Angle Protocol bug bounty program is focused around our smart contracts with a primary interest in the prevention of:

- Thefts and freezing of principal of any amount
- Thefts and freezing of unclaimed yield of any amount
- Theft of governance funds
- Governance activity disruption

For more details, please refer to the [official page of the bounty on Immunefi](https://immunefi.com/bounty/angleprotocol/).

| Level    |                     |
| :------- | :------------------ |
| Critical | up to USD \$500,000 |
| High     | USD \$20,000        |
| Medium   | USD \$2,500         |

All bug reports must include a Proof of Concept demonstrating how the vulnerability can be exploited to be eligible for a reward. This may be a smart contract itself or a transaction.
