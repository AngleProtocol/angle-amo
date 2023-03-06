// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "./MockConvexBaseRewardPool.sol";

//solhint-disable
contract MockConvexBooster {
    uint256 public constant BASE_PARAMS = 10**9;
    mapping(uint256 => MockConvexBaseRewardPool) public rewardPoolMapping;

    error TooSmallAmount();

    constructor() {}

    function setNewBaseRewardPool(MockConvexBaseRewardPool _rewardPool, uint256 convexPoolPid) external {
        rewardPoolMapping[convexPoolPid] = _rewardPool;
    }

    function depositAll(uint256 convexPoolPid, bool) external {
        MockConvexBaseRewardPool baseRewardPool = rewardPoolMapping[convexPoolPid];
        IERC20 token = baseRewardPool.token();
        uint256 amount = token.balanceOf(msg.sender);
        baseRewardPool.deposit(msg.sender, amount);
    }
}
