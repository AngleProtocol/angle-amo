// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../interfaces/IAMOMinter.sol";
import "../interfaces/IAMO.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

contract MockAMOMinter {
    mapping(address => uint256) public callerDebt;
    mapping(address => bool) public isApproved;
    mapping(address => bool) public isGovernor;

    function setCallerDebt(address token, uint256 amount) external {
        callerDebt[token] = amount;
    }

    function setIsApproved(address token, bool status) external {
        isApproved[token] = status;
    }

    function setIsGovernor(address token, bool status) external {
        isGovernor[token] = status;
    }

    function pull(
        IAMO amo,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) external {
        amo.pull(tokens, amounts, new bytes[](0));
    }

    function push(
        IAMO amo,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) external {
        amo.push(tokens, amounts, new bytes[](0));
    }

    function setToken(IAMO amo, IERC20 token) external {
        amo.setToken(token);
    }

    function removeToken(IAMO amo, IERC20 token) external {
        amo.removeToken(token);
    }
}
