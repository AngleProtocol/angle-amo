// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../interfaces/IAMOMinter.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

contract MockAMO {
    mapping(address => bool) public tokens;
    address public amoMinter;
    mapping(address => uint256) public tokenAmounts;
    uint256 public counter;

    function setToken(address token) external {
        tokens[token] = true;
    }

    function removeToken(address token) external {
        tokens[token] = false;
    }

    function isApproved(address _amoMinter, address admin) external view returns (bool) {
        return IAMOMinter(_amoMinter).isApproved(admin);
    }

    function setAMOMinter(address _amoMinter) external {
        amoMinter = _amoMinter;
    }

    function push(
        address[] memory _tokens,
        uint256[] memory amounts,
        bytes[] memory
    ) external {
        for (uint256 i = 0; i < _tokens.length; i++) {
            tokenAmounts[_tokens[i]] += amounts[i];
        }
    }

    function callerDebt(IAMOMinter _amoMinter, IERC20 token) external view returns (uint256) {
        return _amoMinter.callerDebt(token);
    }

    function pull(
        address[] memory _tokens,
        uint256[] memory amounts,
        bytes[] memory
    ) external returns (uint256[] memory) {
        uint256[] memory amountsAvailable = new uint256[](amounts.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            amountsAvailable[i] = IERC20(_tokens[i]).balanceOf(address(this));
            tokenAmounts[address(_tokens[i])] -= amounts[i];
            uint256 allowance = IERC20(_tokens[i]).allowance(address(this), msg.sender);
            if (allowance == 0) IERC20(_tokens[i]).approve(msg.sender, type(uint256).max);
        }
        return amountsAvailable;
    }
}
