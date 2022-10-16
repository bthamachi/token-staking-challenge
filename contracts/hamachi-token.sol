//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract HamachiCoin is ERC20 {
    constructor(uint256 amountToMint) ERC20("Hamachi Coin", "HMC") {
        _mint(msg.sender, amountToMint);
    }
}
