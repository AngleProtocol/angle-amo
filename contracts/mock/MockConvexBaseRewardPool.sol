// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

// import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./MockConvexBooster.sol";

//solhint-disable
contract MockConvexBaseRewardPool is ERC20 {
    uint256 public constant BASE_PARAMS = 10**9;
    MockConvexBooster public convexBooster;
    IERC20 public token;

    error TooSmallAmount();

    constructor(
        string memory name,
        string memory symbol,
        MockConvexBooster _convexBooster,
        IERC20 _token
    ) ERC20(name, symbol) {
        convexBooster = _convexBooster;
        token = _token;
    }

    function deposit(address to, uint256 amount) external {
        token.transferFrom(to, address(this), amount);
        uint256 totalAssets = token.balanceOf(address(this));

        if (totalAssets == 0) _mint(to, amount);
        else _mint(to, (amount * totalSupply()) / totalAssets);
    }

    function withdrawAllAndUnwrap() external {
        uint256 shares = balanceOf(msg.sender);
        uint256 totalAssets = token.balanceOf(address(this));
        _burn(msg.sender, shares);
        token.transfer(msg.sender, (totalAssets * shares) / totalSupply());
    }
}
