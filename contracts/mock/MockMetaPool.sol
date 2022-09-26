// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

//solhint-disable
contract MockMetaPool is ERC20 {
    uint256 public constant BASE_PARAMS = 10**9;
    IERC20 public tokenA;
    IERC20 public tokenB;

    error TooSmallAmount();

    constructor(
        string memory name,
        string memory symbol,
        IERC20 _tokenA,
        IERC20 _tokenB
    ) ERC20(name, symbol) {
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    function calc_withdraw_one_coin(uint256 lpTokenToBurn, int128 index) external view returns (uint256 amount) {
        uint256 balanceA = tokenA.balanceOf(address(this));
        uint256 balanceB = tokenB.balanceOf(address(this));
        uint256 propLpTokenToBurn = (lpTokenToBurn * BASE_PARAMS) / totalSupply();
        if (index == 0) return ((balanceA * propLpTokenToBurn) / BASE_PARAMS);
        else return ((balanceB * propLpTokenToBurn) / BASE_PARAMS);
    }

    function add_liquidity(uint256[] memory amounts, uint256 minLpAmount) external returns (uint256 amount) {
        uint256 balanceA = tokenA.balanceOf(address(this));
        uint256 balanceB = tokenB.balanceOf(address(this));

        uint256 lpTokenForA = balanceA > 0 ? (amounts[0] * totalSupply()) / balanceA : amounts[0];
        uint256 lpTokenForB = balanceB > 0 ? (amounts[1] * totalSupply()) / balanceB : amounts[1];

        amount = lpTokenForA + lpTokenForB;
        if (amount < minLpAmount) revert TooSmallAmount();

        tokenA.transferFrom(msg.sender, address(this), amounts[0]);
        tokenB.transferFrom(msg.sender, address(this), amounts[1]);
        _mint(msg.sender, amount);

        return amount;
    }

    function remove_liquidity_imbalance(uint256[] memory amounts, uint256 maxLpAmount)
        external
        returns (uint256 amount)
    {
        uint256 balanceA = tokenA.balanceOf(address(this));
        uint256 balanceB = tokenB.balanceOf(address(this));
        uint256 lpTokenForA = balanceA > 0 ? (amounts[0] * totalSupply()) / balanceA : type(uint256).max;
        uint256 lpTokenForB = balanceB > 0 ? (amounts[1] * totalSupply()) / balanceB : type(uint256).max;

        amount = lpTokenForA + lpTokenForB;
        if (amount > maxLpAmount) revert TooSmallAmount();

        _burn(msg.sender, amount);
        tokenA.transfer(msg.sender, amounts[0]);
        tokenB.transfer(msg.sender, amounts[1]);

        return amount;
    }

    function remove_liquidity_one_coin(
        uint256 lpTokenToBurn,
        int128 index,
        uint256 minAmount
    ) external returns (uint256 amount) {
        if (totalSupply() == 0) revert TooSmallAmount();

        uint256 balanceA = tokenA.balanceOf(address(this));
        uint256 balanceB = tokenB.balanceOf(address(this));
        uint256 propLpTokenToBurn = (lpTokenToBurn * BASE_PARAMS) / totalSupply();
        if (index == 0) amount = (balanceA * propLpTokenToBurn) / BASE_PARAMS;
        else amount = (balanceB * propLpTokenToBurn) / BASE_PARAMS;

        if (amount < minAmount) revert TooSmallAmount();

        _burn(msg.sender, lpTokenToBurn);
        if (index == 0) tokenA.transfer(msg.sender, amount);
        else tokenB.transfer(msg.sender, amount);

        return amount;
    }
}
