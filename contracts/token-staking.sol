//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "hardhat/console.sol";

contract TokenStakingContract is Ownable, ERC20 {
    // Code goes here
    IERC20 rewardToken;
    uint256 lastUpdate;
    uint256 currentStaked;
    uint256 public rewardTokenPerSecond;
    bool vaultActive;

    // Token Reward Rate is the # of reward tokens per day
    constructor(address _rewardToken, uint256 _rewardRate)
        ERC20("Hamachi Rewards", "HMR")
    {
        currentStaked = 0;
        rewardToken = IERC20(_rewardToken);
        lastUpdate = block.timestamp;
        rewardTokenPerSecond = _rewardRate;
    }

    function updateRewardRate(uint256 _rewardRate) public onlyOwner {
        currentStaked = getCurrentStakedValue();
        lastUpdate = block.timestamp;
        rewardTokenPerSecond = _rewardRate;
    }

    function getCurrentStakedValue() public view returns (uint256) {
        if (vaultActive) {
            return
                currentStaked +
                (block.timestamp - lastUpdate) *
                rewardTokenPerSecond;
        }
        return 0;
    }

    function withdraw(uint256 lpTokensToBeRedeemed) public {
        require(
            rewardToken.balanceOf(address(this)) > 0,
            "Vault has been emptied"
        );
        require(
            totalSupply() > 0,
            "Existing tokens are required in order to be able to withdraw money"
        );
        require(
            balanceOf(msg.sender) >= lpTokensToBeRedeemed,
            "Cannot redeem for more tokens than you have"
        );
        require(vaultActive, "Vault is currently inactive");

        // The outstanding amount of LP Tokens simply tracks the percentage of the pot he can wtihdraw
        uint256 withdrawAmount = (lpTokensToBeRedeemed *
            getCurrentStakedValue()) / totalSupply();

        if (lpTokensToBeRedeemed == totalSupply()) {
            withdrawAmount = getCurrentStakedValue();
        }

        require(
            withdrawAmount <= rewardToken.balanceOf(address(this)),
            "Insufficient Value in Contract to redeem tokens. Please try again later"
        );

        // We update internal variables

        bool succesfulRewardTransfer = rewardToken.transfer(
            msg.sender,
            withdrawAmount
        );

        require(
            succesfulRewardTransfer,
            "Redemption failed for reward. Please try again later."
        );
        // We only update state when the tokens have been transfered.
        currentStaked = getCurrentStakedValue() - withdrawAmount;
        lastUpdate = block.timestamp;
        _burn(msg.sender, lpTokensToBeRedeemed);
    }

    function deposit(uint256 rewardTokenAmount) public {
        require(
            rewardToken.balanceOf(address(this)) > 0,
            "Vault has ran out of funding. Please try again later"
        );
        // We first get the money from the user
        bool successTransfer = rewardToken.transferFrom(
            msg.sender,
            address(this),
            rewardTokenAmount
        );

        require(
            successTransfer,
            "Unable to transfer tokens into contract. Please try again later"
        );

        // If we have no more tokens.
        if (totalSupply() == 0) {
            // We just mint an equivalent amount of reward tokens. Initial Target is just 1 : 1, so 1 reward token to 1 staked lp token.
            _mint(msg.sender, rewardTokenAmount);
            vaultActive = true;
            currentStaked = rewardTokenAmount;
        } else {
            uint256 newStakedValue = rewardTokenAmount +
                getCurrentStakedValue();
            uint256 lpTokensToMint = (rewardTokenAmount * totalSupply()) /
                (newStakedValue - rewardTokenAmount);
            _mint(msg.sender, lpTokensToMint);

            currentStaked = newStakedValue;
        }

        lastUpdate = block.timestamp;
    }
}
