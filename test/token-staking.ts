import { expect } from "chai";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { TokenStakingContract } from "../typechain-types";
import { HamachiCoin } from "../typechain-types/contracts/hamachi-token.sol";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber } from "ethers";


describe("Staking Contract", function () {

    const totalCoins = 10000;
    const decimals = 18;
    const totalSupply = BigNumber.from(totalCoins).mul(BigNumber.from(10).pow(decimals))
    const rewardRatePerSecond = 100
    let fundingAmount: BigNumber;
    const imprecision = 10 ** 7

    let HamachiToken: HamachiCoin
    let StakingContract: TokenStakingContract


    let owner: SignerWithAddress;
    let addr1: SignerWithAddress;
    let addr2: SignerWithAddress
    let addrs: SignerWithAddress[];

    let beneficiary: SignerWithAddress;

    beforeEach(async function () {


        // Provision Addresses first
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();


        // Create Contract Interfaces
        const StakingContractFactory = await ethers.getContractFactory("TokenStakingContract", owner);
        const HamachiCoinFactory = await ethers.getContractFactory("HamachiCoin", owner);

        // Deploy Contracts

        // We mint a total of 10,000 Hamachi Tokens and track balances with an accuracy of 18 decimal places.
        HamachiToken = await HamachiCoinFactory.deploy(
            totalSupply
        );


        // We are generous and give up 1 Hamachi Coin each day that is shared between everybody who decides to stake their coins in this LP
        fundingAmount = BigNumber.from(40).mul(BigNumber.from(10).pow(decimals))

        StakingContract = await StakingContractFactory.deploy(
            HamachiToken.address,
            rewardRatePerSecond,
        )

        // We fund the Staking Contract with some money



        // We then fund the two addresses with a 100 tokens each
        fundingAmount = BigNumber.from(100).mul(BigNumber.from(10).pow(decimals))
        await HamachiToken.transfer(addr1.address, fundingAmount)
        await HamachiToken.transfer(addr2.address, fundingAmount)

    });


    //Other tests go here
    describe("Post Deployment Checks", () => {
        beforeEach(async function () {
            await HamachiToken.transfer(StakingContract.address, totalSupply.div(2))
        })
        // Initial Staked Value should be 0 if no one deposits into vault
        it("should have a staked value of 0 if no one deposits no matter how much time passes", async function () {
            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(0);
            time.increase(1000);
            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(0);
        })
        it("should not allow anyone to withdraw the staked amount if no LP tokens are in circulation", async function () {
            await expect(StakingContract.connect(addr1).withdraw(10)).to.be.revertedWith("Existing tokens are required in order to be able to withdraw money")
        })
    })

    describe("Vault Balance Check", () => {
        it("should prevent users from depositing any tokens if vault has no money", async function () {
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))
            await expect(StakingContract.connect(addr1).deposit(stakedAmountOfTokens)).to.be.revertedWith(
                "Vault has ran out of funding. Please try again later"
            )
        })
        it("should prevent users from withdrawing any tokens if vault has no money", async function () {
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))
            await expect(StakingContract.connect(addr1).withdraw(stakedAmountOfTokens)).to.be.revertedWith(
                "Vault has been emptied"
            )
        })


        it("should throw an error when the vault doesn't have enough money to repay users", async function () {
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(2))
            await HamachiToken.transfer(StakingContract.address, stakedAmountOfTokens)

            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens.mul(4));
            await StakingContract.connect(addr1).deposit(stakedAmountOfTokens.mul(4))
            await StakingContract.updateRewardRate(10 * 10 ** 4);

            time.increase(40000);

            await expect(StakingContract.connect(addr1).withdraw(
                await StakingContract.balanceOf(addr1.address)
            )).to.be.revertedWith("Insufficient Value in Contract to redeem tokens. Please try again later")
        })

    })

    describe("Input Validation", () => {
        beforeEach(async function () {
            await HamachiToken.transfer(StakingContract.address, totalSupply.div(2))
        })
        it("should only allow the user to redeem a valid number of lp tokens", async function () {
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))
            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens);

            await StakingContract.connect(addr1).deposit(stakedAmountOfTokens)
            await expect(StakingContract.connect(addr1).withdraw(
                (await StakingContract.balanceOf(addr1.address)).mul(2)
            )).to.be.revertedWith(
                "Cannot redeem for more tokens than you have"
            )
        })
    })

    describe("Updating Reward Rate", () => {
        beforeEach(async function () {
            await HamachiToken.transfer(StakingContract.address, totalSupply.div(2))
        })
        it("should accurately calculate the amount owed to a single staker if reward rate is increased", async function () {

            // Step 1  :We first deposit 2 tokens into the contract
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))
            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens);
            const initialDeposit = await StakingContract.connect(addr1).deposit(stakedAmountOfTokens)

            // Step 2 : We increment the time by 1 day
            await time.increase(24 * 60 * 60);

            // Step 3 : We increment the reward rate to double the original amount
            const updateBlock = await StakingContract.updateRewardRate(rewardRatePerSecond * 2);

            // Step 4 : We increment the time by 1 day
            await time.increase(24 * 60 * 60);

            const withdrawBlock = await StakingContract.connect(addr1).withdraw(
                await StakingContract.balanceOf(addr1.address)
            )

            const initialDepositTimestamp = (await ethers.provider.getBlock(initialDeposit.blockNumber!)).timestamp
            const updateBlockTimestamp = (await ethers.provider.getBlock(updateBlock.blockNumber!)).timestamp
            const withdrawBlockTimestamp = (await ethers.provider.getBlock(withdrawBlock.blockNumber!)).timestamp

            const expectedStakingRewards = (updateBlockTimestamp - initialDepositTimestamp) * rewardRatePerSecond + (withdrawBlockTimestamp - updateBlockTimestamp) * 2 * rewardRatePerSecond

            expect(await HamachiToken.balanceOf(addr1.address)).to.be.equal(
                fundingAmount.add(expectedStakingRewards)
            )
        })

        it("should accurately calculate the amount owed to two stakers if one joins after the new increased reward rate", async function () {
            // Step 1 : We first deposit 2 tokens into the contract
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))
            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens);
            const initialDeposit = await StakingContract.connect(addr1).deposit(stakedAmountOfTokens)

            // Step 2 : We then  increment the time by 1 day
            await time.increase(24 * 60 * 60);

            // Step 3 : We update the staking amount
            const updateBlock = await StakingContract.updateRewardRate(rewardRatePerSecond * 2);

            // Step 4 : We increment the time by 1 day
            await time.increase(24 * 60 * 60);


            await HamachiToken.connect(addr2).approve(StakingContract.address, stakedAmountOfTokens);
            const newAddition = await StakingContract.connect(addr2).deposit(stakedAmountOfTokens)

            const addr1LP = await StakingContract.balanceOf(addr1.address)
            const addr2LP = await StakingContract.balanceOf(addr2.address)
            const totalLP = addr1LP.add(addr2LP)

            // Step 5 : We increment the time by a day too
            await time.increase(24 * 60 * 60);

            // Step 6 : The new joiner outlasts the older one
            const addr1Withdrawal = await StakingContract.connect(addr1).withdraw(
                await StakingContract.balanceOf(addr1.address)
            )

            // Step 7 : We increment the time by a second day
            await time.increase(24 * 60 * 60)

            // Step 8 : We withdraw from the existing joiner
            const addr2Withdrawal = await StakingContract.connect(addr2).withdraw(
                await StakingContract.balanceOf(addr2.address)
            )

            // Step 9 : Verify that balances are ok
            const addr1DepositTimestamp = (await ethers.provider.getBlock(initialDeposit.blockNumber!)).timestamp
            const initialRateIncreaseTimestamp = (await ethers.provider.getBlock(updateBlock.blockNumber!)).timestamp
            const addr2DepositTimestamp = (await ethers.provider.getBlock(newAddition.blockNumber!)).timestamp
            const addr1WithdrawalTimestamp = (await ethers.provider.getBlock(addr1Withdrawal.blockNumber!)).timestamp
            const addr2WithdrawalTimestamp = (await ethers.provider.getBlock(addr2Withdrawal.blockNumber!)).timestamp


            // We verify address 1's balance
            const addr1BeforeRateIncrease = (initialRateIncreaseTimestamp - addr1DepositTimestamp) * rewardRatePerSecond
            const addr1BeforeAddr2Deposit = (addr2DepositTimestamp - initialRateIncreaseTimestamp) * 2 * rewardRatePerSecond
            const addr1SharingAddr2 = addr1LP.mul(rewardRatePerSecond).div(totalLP).mul(addr1WithdrawalTimestamp - addr2DepositTimestamp)

            const addr1ExpectedRewards = addr1SharingAddr2.add(addr1BeforeRateIncrease + addr1BeforeAddr2Deposit)

            expect(
                await HamachiToken.balanceOf(addr1.address)
            ).to.be.approximately(
                fundingAmount.add(addr1ExpectedRewards),
                imprecision
            )

            // We verify address 2's balance
            const addr2SharingAddr1 = addr2LP.mul(rewardRatePerSecond).div(totalLP).mul(addr1WithdrawalTimestamp - addr2DepositTimestamp)
            const addr2AfterAddr1Withdrawl = (addr2WithdrawalTimestamp - addr1WithdrawalTimestamp) * rewardRatePerSecond * 2
            const addr2ExpectedRewards = addr2SharingAddr1.add(addr2AfterAddr1Withdrawl)

            expect(
                await HamachiToken.balanceOf(addr2.address)
            ).to.be.approximately(
                fundingAmount.add(addr2ExpectedRewards),
                imprecision
            )





        })
    })

    describe("Staking and Withdrawls", () => {
        beforeEach(async function () {
            await HamachiToken.transfer(StakingContract.address, totalSupply.div(2))
        })
        it("should allow someone to stake their tokens if they have enough money", async function () {
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))
            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens);

            await StakingContract.connect(addr1).deposit(stakedAmountOfTokens)
            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(stakedAmountOfTokens)
        })

        it("should correctly calculate the reward amount according to the daily rate of 100 * 10e-18 tokens per second", async function () {


            // We Deposit 2 full tokens into contraCt
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))

            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens);
            const depositTransaction = await StakingContract.connect(addr1).deposit(stakedAmountOfTokens)
            expect(await HamachiToken.balanceOf(addr1.address)).to.be.equal(fundingAmount.sub(stakedAmountOfTokens))
            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(stakedAmountOfTokens)


            const numberOfSecondsInTwoDays = 24 * 60 * 60 * 2
            // We wait for 2 days
            await time.increase(numberOfSecondsInTwoDays)


            // // We expect current staked value to be increased by rewardRate * Time passed
            const expectedNewStake = stakedAmountOfTokens.add(numberOfSecondsInTwoDays * rewardRatePerSecond)
            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(expectedNewStake)

            // We then withdraw and redeem
            const withdrawlTransaction = await StakingContract.connect(addr1).withdraw(StakingContract.balanceOf(addr1.address))

            const initialTimestamp = (await ethers.provider.getBlock(depositTransaction.blockHash!)).timestamp
            const finalTimestamp = (await ethers.provider.getBlock(withdrawlTransaction.blockHash!)).timestamp

            // User got back his 
            expect(await HamachiToken.balanceOf(addr1.address)).to.be.equal(
                fundingAmount.add((finalTimestamp - initialTimestamp) * rewardRatePerSecond))
        })

        it("should support multiple users who have deposited an equal amount", async function () {
            // Step 1 : Each user will deposit a total of 2 tokens each
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))
            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens);
            await HamachiToken.connect(addr2).approve(StakingContract.address, stakedAmountOfTokens);

            const addr1Deposit = await StakingContract.connect(addr1).deposit(stakedAmountOfTokens)
            const addr2Deposit = await StakingContract.connect(addr2).deposit(stakedAmountOfTokens)

            const addr1DepositTimestamp = (await ethers.provider.getBlock(addr1Deposit.blockHash!)).timestamp
            const addr2DepositTimestamp = (await ethers.provider.getBlock(addr2Deposit.blockHash!)).timestamp

            // Step 2 : We ensure that each user has indeed transfered in 4 staked tokens
            expect(await HamachiToken.balanceOf(addr1.address)).to.be.equal(fundingAmount.sub(stakedAmountOfTokens))
            expect(await HamachiToken.balanceOf(addr2.address)).to.be.equal(fundingAmount.sub(stakedAmountOfTokens))

            // Step 3 : We ensure that the staked contract a current staked value that is 
            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(
                stakedAmountOfTokens.add(stakedAmountOfTokens.add(
                    (addr2DepositTimestamp - addr1DepositTimestamp) * rewardRatePerSecond
                ))
            )

            // Step 4 : We increment the time by a solid 2 days
            const timeStaked = 24 * 2 * 60 * 60
            // We wait for 2 days
            await time.increase(timeStaked)

            const stake1 = await StakingContract.balanceOf(addr1.address)
            const stake2 = await StakingContract.balanceOf(addr2.address)
            const totalStake = stake1.add(stake2)


            // Step 5 : Each User then withdrawls all their tokens
            const addr1Withdrawal = await StakingContract.connect(addr1).withdraw(
                await StakingContract.balanceOf(addr1.address)
            )
            const addr2Withdrawal = await StakingContract.connect(addr2).withdraw(
                await StakingContract.balanceOf(addr2.address)
            )

            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(0)

            const addr1WithdrawalTimestamp = (await ethers.provider.getBlock(addr1Withdrawal.blockHash!)).timestamp
            const addr2WithdrawalTimestamp = (await ethers.provider.getBlock(addr2Withdrawal.blockHash!)).timestamp

            // Calculates the amount they earned per second 
            const addr1Earnings = stake1.mul(rewardRatePerSecond).div(totalStake)


            const expectedRewardAddr1 = addr1Earnings.mul(addr1WithdrawalTimestamp - addr2DepositTimestamp).add((addr2WithdrawalTimestamp - addr1WithdrawalTimestamp) * rewardRatePerSecond)


            const expectedRewardAddr2 = (stake2.mul(addr1WithdrawalTimestamp - addr2DepositTimestamp).mul(rewardRatePerSecond).div(totalStake)).add(
                (addr2WithdrawalTimestamp - addr1WithdrawalTimestamp) * rewardRatePerSecond
            )

            // We then ensure that each user has obtained the staked amount they were promised. We allow for a delta of 1e-15
            expect(await HamachiToken.balanceOf(addr1.address)).to.be.approximately(
                fundingAmount.add(expectedRewardAddr1), imprecision
            )
            expect(await HamachiToken.balanceOf(addr2.address)).to.be.approximately(
                fundingAmount.add(expectedRewardAddr2), imprecision
            )
        })

        it("should allow users to top up an additional amount of money to be staked and still return the right amount", async function () {
            // Step 1 : We deposit our money into the contract in stages
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals));

            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens.mul(4));
            const addr1Deposit = await StakingContract.connect(addr1).deposit(stakedAmountOfTokens);


            // Step 4 : We increment the time by a day
            const timeStaked = 24 * 60 * 60
            // We wait for 2 days
            await time.increase(timeStaked)

            const addr1Deposit2 = await StakingContract.connect(addr1).deposit(stakedAmountOfTokens.mul(2));

            await time.increase(timeStaked);

            const addr1Deposit3 = await StakingContract.connect(addr1).deposit(stakedAmountOfTokens);

            await time.increase(timeStaked);

            const completeWithdrawl = await StakingContract.connect(addr1).withdraw(
                await StakingContract.balanceOf(addr1.address)
            )

            expect(await HamachiToken.balanceOf(addr1.address)).to.be.approximately(
                fundingAmount.add(
                    24 * 60 * 60 * 3 * rewardRatePerSecond
                ),
                imprecision
            )

        })

        it("should support multiple users who have deposited an unequal amount", async function () {
            // Step 1 : Each user will deposit a total of 2 tokens each
            const stakedAmountOfTokens = BigNumber.from(2).mul(BigNumber.from(10).pow(decimals))
            await HamachiToken.connect(addr1).approve(StakingContract.address, stakedAmountOfTokens);
            await HamachiToken.connect(addr2).approve(StakingContract.address, stakedAmountOfTokens.mul(3));

            const addr1Deposit = await StakingContract.connect(addr1).deposit(stakedAmountOfTokens)
            const addr2Deposit = await StakingContract.connect(addr2).deposit(stakedAmountOfTokens)

            const addr1DepositTimestamp = (await ethers.provider.getBlock(addr1Deposit.blockHash!)).timestamp
            const addr2DepositTimestamp = (await ethers.provider.getBlock(addr2Deposit.blockHash!)).timestamp

            // Step 2 : We ensure that each user has indeed transfered in 4 staked tokens
            expect(await HamachiToken.balanceOf(addr1.address)).to.be.equal(fundingAmount.sub(stakedAmountOfTokens))
            expect(await HamachiToken.balanceOf(addr2.address)).to.be.equal(fundingAmount.sub(stakedAmountOfTokens))

            // Step 3 : We ensure that the staked contract a current staked value that is 
            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(
                stakedAmountOfTokens.add(stakedAmountOfTokens.add(
                    (addr2DepositTimestamp - addr1DepositTimestamp) * rewardRatePerSecond
                ))
            )

            // Step 4 : We increment the time by a solid 2 days
            const timeStaked = 24 * 60 * 60 * 2
            // We wait for 2 days
            await time.increase(timeStaked)

            const stake1 = await StakingContract.balanceOf(addr1.address)
            const stake2 = await StakingContract.balanceOf(addr2.address)
            const totalStake = stake1.add(stake2)


            // Step 5 : Each User then withdrawls all their tokens
            const addr1Withdrawal = await StakingContract.connect(addr1).withdraw(
                await StakingContract.balanceOf(addr1.address)
            )
            const addr2Withdrawal = await StakingContract.connect(addr2).withdraw(
                await StakingContract.balanceOf(addr2.address)
            )

            expect(await StakingContract.getCurrentStakedValue()).to.be.equal(0)

            const addr1WithdrawalTimestamp = (await ethers.provider.getBlock(addr1Withdrawal.blockHash!)).timestamp
            const addr2WithdrawalTimestamp = (await ethers.provider.getBlock(addr2Withdrawal.blockHash!)).timestamp

            // Calculates the amount they earned per second 
            const addr1Earnings = stake1.mul(rewardRatePerSecond).div(totalStake)


            const expectedRewardAddr1 = addr1Earnings.mul(addr1WithdrawalTimestamp - addr2DepositTimestamp).add((addr2WithdrawalTimestamp - addr1WithdrawalTimestamp) * rewardRatePerSecond)


            const expectedRewardAddr2 = (stake2.mul(addr1WithdrawalTimestamp - addr2DepositTimestamp).mul(rewardRatePerSecond).div(totalStake)).add(
                (addr2WithdrawalTimestamp - addr1WithdrawalTimestamp) * rewardRatePerSecond
            )

            // We then ensure that each user has obtained the staked amount they were promised. We allow for a delta of 1e-15
            expect(await HamachiToken.balanceOf(addr1.address)).to.be.approximately(
                fundingAmount.add(expectedRewardAddr1), imprecision
            )
            expect(await HamachiToken.balanceOf(addr2.address)).to.be.approximately(
                fundingAmount.add(expectedRewardAddr2), imprecision
            )
        })
    })



})


