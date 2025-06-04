// Import necessary libraries from Algorand TypeScript
import {
  abimethod,
  Account,
  arc4,
  assert,
  Asset,
  BoxMap,
  contract,
  Contract,
  Global,
  GlobalState,
  gtxn,
  itxn,
  TransactionType,
  Txn,
  uint64,
} from '@algorandfoundation/algorand-typescript'

/**
 * User stake information stored in box storage
 */
export class UserStakeInfo extends arc4.Struct<{
  // Amount of tokens staked by this user
  stakedAmount: arc4.UintN64
  // Timestamp when user first staked (never changes after first stake)
  firstStakeTime: arc4.UintN64
  // Timestamp when user last staked or added to stake
  lastStakeTime: arc4.UintN64
  // Cumulative rewards earned
  totalRewardsEarned: arc4.UintN64
  // User's reward debt for accumulator pattern
  rewardDebt: arc4.UintN64
}> {}

/**
 * ASA Staking Contract for Algorand with Fixed Weekly Reward Pool
 *
 * This contract allows users to:
 * - Stake an ASA token
 * - Earn proportional rewards from a fixed weekly pool of 100,000 tokens
 * - Add to their stake at any time
 * - Withdraw part or all of their stake at any time
 * - Claim rewards at any time
 * - Dynamic APY that adjusts based on total staked amount
 *
 * This implementation uses box storage to store user staking information
 * and an accumulator pattern for gas-efficient reward distribution
 */
@contract({ stateTotals: { globalBytes: 8 } })
export class ASAStakingContract extends Contract {
  public asset = GlobalState<Asset>({ initialValue: Asset() })
  public adminAddress = GlobalState<Account>({ initialValue: Account()})
  public totalStaked = GlobalState<uint64>({ initialValue: 0 })
  public lastRewardTime = GlobalState<uint64>({ initialValue: 0 })
  public minimumStake = GlobalState<uint64>({ initialValue: 0 })
  public rewardPool = GlobalState<uint64>({ initialValue: 0 })
  public accumulatedRewardsPerShare = GlobalState<uint64>({ initialValue: 0 })

  // Constants for fixed reward system - now as GlobalState for flexibility
  public weeklyRewards = GlobalState<uint64>({ initialValue: 0 })
  public rewardPeriod = GlobalState<uint64>({ initialValue: 0 })

  public stakers = BoxMap<Account, UserStakeInfo>({ keyPrefix: 'stakers' })

  /**
   * Helper function to read user stake info from box storage
   */
  public getUserStakeInfo(userAddress: Account): UserStakeInfo {
    const userBox = this.stakers(userAddress)

    if (userBox.exists) {
      return userBox.value.copy()
    } else {
      return new UserStakeInfo({
        stakedAmount: new arc4.UintN64(0),
        firstStakeTime: new arc4.UintN64(0),
        lastStakeTime: new arc4.UintN64(0),
        totalRewardsEarned: new arc4.UintN64(0),
        rewardDebt: new arc4.UintN64(0),
      })
    }
  }

  /**
   * Helper function to store user stake info in box storage
   */
  public storeUserStakeInfo(userAddress: Account, stakeInfo: UserStakeInfo): void {
    this.stakers(userAddress).value = stakeInfo.copy()
  }

  /**
   * Update accumulated rewards per share if reward period has passed
   */
  private updateRewards(): void {
    const currentTime = Global.latestTimestamp
    const lastReward = this.lastRewardTime.value
    const rewardPeriod = this.rewardPeriod.value
    
    // Check if a full reward period has passed
    if (currentTime >= lastReward + rewardPeriod && this.totalStaked.value > 0) {
      // Calculate how many complete periods have passed
      const periodsPassed: uint64 = (currentTime - lastReward) / rewardPeriod
      
      // Update accumulated rewards per share
      const rewardPerPeriod = this.weeklyRewards.value
      const totalRewards: uint64 = rewardPerPeriod * periodsPassed
      
      // Simple division - rewards per token staked
      const totalStaked = this.totalStaked.value
      const rewardPerShare: uint64 = totalRewards / totalStaked
      
      this.accumulatedRewardsPerShare.value = this.accumulatedRewardsPerShare.value + rewardPerShare
      
      // Update last reward time to the most recent complete period
      this.lastRewardTime.value = lastReward + (periodsPassed * rewardPeriod)
      
      // Deduct rewards from pool
      this.rewardPool.value = this.rewardPool.value - totalRewards
    }
  }

  /**
   * Calculate pending rewards for a user
   */
  private calculatePendingRewards(userAddress: Account): uint64 {
    const stakeInfo = this.getUserStakeInfo(userAddress)
    
    if (stakeInfo.stakedAmount.native === 0) {
      return 0
    }
    
    const userStake = stakeInfo.stakedAmount.native
    const accRewardsPerShare = this.accumulatedRewardsPerShare.value
    const userRewardDebt = stakeInfo.rewardDebt.native
    
    // Simple calculation without precision
    const totalEarned: uint64 = userStake * accRewardsPerShare
    const pendingRewards: uint64 = totalEarned > userRewardDebt ? totalEarned - userRewardDebt : 0
    
    return pendingRewards
  }

  /**
   * Initialize the contract with the ASA token ID and other parameters
   */
  @abimethod()
  public initialize(
    asset: Asset,
    adminAddress: Account,
    minimumStake: uint64,
    weeklyRewards: uint64,
    rewardPeriod: uint64,
  ): void {
    // Ensure this is only called during contract creation
    assert(this.asset.value === Asset(), 'Already initialized')

    // Ensure only the creator can initialize
    assert(Txn.sender === Global.creatorAddress, 'Only creator can initialize')

    // Store the initial parameters
    this.asset.value = asset
    this.adminAddress.value = adminAddress
    this.totalStaked.value = 0
    this.lastRewardTime.value = Global.latestTimestamp
    this.minimumStake.value = minimumStake
    this.rewardPool.value = 0
    this.accumulatedRewardsPerShare.value = 0
    
    // Set reward system parameters
    this.weeklyRewards.value = weeklyRewards
    this.rewardPeriod.value = rewardPeriod
  }

  /**
   * Opt the contract into the ASA
   */
  @abimethod()
  public optInToAsset(): void {
    // Ensure only the creator or admin can opt in
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === Global.creatorAddress || Txn.sender === adminAddr, 'Only creator or admin can opt in')

    // Opt the contract into the ASA
    const asset = this.asset.value
    itxn
      .assetTransfer({
        assetReceiver: Global.currentApplicationAddress,
        assetAmount: 0,
        xferAsset: asset,
      })
      .submit()
  }

  /**
   * Stake tokens
   * Requires a companion ASA transfer transaction
   * Automatically claims pending rewards
   */
  @abimethod()
  public stake(): void {
    // Ensure the contract has opted into the ASA
    const asset = this.asset.value
    assert(this.asset.value !== Asset(), 'Contract not initialized')

    // Ensure this call has a companion ASA transfer transaction
    assert(Global.groupSize === 2, 'Expected 2 txns in group')

    // Get the ASA transfer details
    const xferTxn = gtxn.AssetTransferTxn(0)
    assert(xferTxn.type === TransactionType.AssetTransfer, 'Transaction 0 must be asset transfer')
    assert(xferTxn.assetReceiver === Global.currentApplicationAddress, 'Asset transfer must be to contract')
    assert(xferTxn.assetAmount > 0, 'Must stake non-zero amount')
    assert(xferTxn.xferAsset === asset, 'Incorrect asset ID')

    // Get the stake amount from the transaction
    const stakeAmount = xferTxn.assetAmount
    const minimumStake = this.minimumStake.value
    const senderAddress = Txn.sender

    // Get the current user stake info
    const stakeInfo = this.getUserStakeInfo(senderAddress)

    // If this is a new stake, ensure it meets minimum
    if (stakeInfo.stakedAmount.native === 0) {
      assert(stakeAmount >= minimumStake, 'Initial stake below minimum')
      // Set the first stake time (this never changes after initial stake)
      stakeInfo.firstStakeTime = new arc4.UintN64(Global.latestTimestamp)
    }

    // Update stake info
    stakeInfo.stakedAmount = new arc4.UintN64(stakeInfo.stakedAmount.native + stakeAmount)
    stakeInfo.lastStakeTime = new arc4.UintN64(Global.latestTimestamp)
    
    // Update reward debt
    stakeInfo.rewardDebt = new arc4.UintN64(stakeInfo.stakedAmount.native * this.accumulatedRewardsPerShare.value)

    // Store updated stake info
    this.storeUserStakeInfo(senderAddress, stakeInfo)

    // Update global state
    this.totalStaked.value = this.totalStaked.value + stakeAmount
  }

  /**
   * Withdraw staked tokens
   * Automatically claims pending rewards
   */
  @abimethod()
  public withdraw(amount: uint64): void {
    const senderAddress = Txn.sender
    const stakeInfo = this.getUserStakeInfo(senderAddress)

    // Ensure user has enough staked
    assert(stakeInfo.stakedAmount.native > 0, 'No stake found')
    assert(amount <= stakeInfo.stakedAmount.native, 'Withdrawal amount exceeds stake')
    assert(amount > 0, 'Withdrawal amount must be positive')

    // If withdrawing all, no need to check minimum remaining
    // If partial withdrawal, ensure remaining stake meets minimum
    if (amount < stakeInfo.stakedAmount.native) {
      const remainingStake: uint64 = stakeInfo.stakedAmount.native - amount
      const minimumStake = this.minimumStake.value
      assert(remainingStake >= minimumStake, 'Remaining stake would be below minimum')
    }

    // Update stake info
    stakeInfo.stakedAmount = new arc4.UintN64(stakeInfo.stakedAmount.native - amount)
    
    // Update reward debt
    stakeInfo.rewardDebt = new arc4.UintN64(stakeInfo.stakedAmount.native * this.accumulatedRewardsPerShare.value)

    // Store updated stake info
    this.storeUserStakeInfo(senderAddress, stakeInfo)

    // Update global state
    this.totalStaked.value = this.totalStaked.value - amount

    // Transfer tokens back to user
    const asset = this.asset.value
    itxn
      .assetTransfer({
        assetReceiver: senderAddress,
        assetAmount: amount,
        xferAsset: asset,
        fee: 1000,
      })
      .submit()
  }

  /**
   * Add rewards to the reward pool
   * Only the admin can call this
   * Requires a companion ASA transfer transaction with the rewards
   */
  @abimethod()
  public addRewards(): void {
    // Ensure only admin can add rewards
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === adminAddr, 'Only admin can add rewards')

    // Ensure this call has a companion ASA transfer transaction with rewards
    assert(Global.groupSize === 2, 'Expected 2 txns in group')

    // Get the ASA transfer details
    const asset = this.asset.value
    const xferTxn = gtxn.AssetTransferTxn(0)
    assert(xferTxn.type === TransactionType.AssetTransfer, 'Transaction 0 must be asset transfer')
    assert(xferTxn.assetReceiver === Global.currentApplicationAddress, 'Asset transfer must be to contract')
    assert(xferTxn.assetAmount > 0, 'Must provide non-zero rewards')
    assert(xferTxn.xferAsset === asset, 'Incorrect asset ID')

    // Add rewards to the pool
    this.rewardPool.value = this.rewardPool.value + xferTxn.assetAmount
  }

  /**
   * Calculate current APY based on total staked amount
   */
  @abimethod({ readonly: true })
  public getCurrentAPY(): uint64 {
    const totalStaked = this.totalStaked.value
    
    if (totalStaked === 0) {
      return 0 // Return 0 if no tokens staked
    }
    
    // Calculate annual rewards: 52 weeks * weeklyRewards
    const annualRewards: uint64 = 52 * this.weeklyRewards.value
    
    // APY = (annualRewards / totalStaked) * 10000 (in basis points)
    const apy: uint64 = (annualRewards * 100) / totalStaked
    
    return apy
  }

  /**
   * Get pending rewards for a specific user
   */
  @abimethod({ readonly: true })
  public getPendingRewards(userAddress: Account): uint64 {
    return this.calculatePendingRewards(userAddress)
  }

  /**
   * Trigger reward distribution manually (admin only)
   * Updates accumulated rewards per share if period has passed
   */
  @abimethod()
  public triggerRewardDistribution(): void {
    // Ensure only admin can trigger distribution
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === adminAddr, 'Only admin can trigger distribution')
    
    // Update rewards
    this.updateRewards()
  }

  /**
   * Update the admin address
   * Only the current admin can call this
   */
  @abimethod()
  public updateAdmin(newAdminAddress: Account): void {
    // Ensure only admin can update admin
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === adminAddr, 'Only admin can update admin')

    // Update admin address
    this.adminAddress.value = newAdminAddress
  }

  /**
   * Get current staking statistics for a user
   */
  @abimethod({ readonly: true })
  public getUserStats(userAddress: Account): Array<uint64> {
    const stakeInfo = this.getUserStakeInfo(userAddress)
    const pendingRewards = this.calculatePendingRewards(userAddress)
    
    const result: uint64[] = [
      stakeInfo.stakedAmount.native,
      stakeInfo.firstStakeTime.native,
      stakeInfo.lastStakeTime.native,
      stakeInfo.totalRewardsEarned.native,
      pendingRewards,
      stakeInfo.rewardDebt.native,
    ]

    return result
  }

  /**
   * Get contract global statistics
   */
  @abimethod({ readonly: true })
  public getContractStats(): Array<uint64> {
    const currentAPY = this.getCurrentAPY()
    
    const result: uint64[] = [
      this.asset.value.id,
      this.totalStaked.value,
      currentAPY,
      this.lastRewardTime.value,
      this.rewardPeriod.value,
      this.minimumStake.value,
      this.rewardPool.value,
      this.accumulatedRewardsPerShare.value,
    ]

    return result
  }

  /**
   * Emergency withdraw rewards from pool (admin only)
   */
  @abimethod()
  public emergencyWithdrawRewards(amount: uint64): void {
    // Ensure only admin can withdraw
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === adminAddr, 'Only admin can emergency withdraw')

    // Ensure sufficient funds in reward pool
    assert(this.rewardPool.value >= amount, 'Insufficient reward pool')

    // Update reward pool
    this.rewardPool.value = this.rewardPool.value - amount

    // Transfer tokens to admin
    const asset = this.asset.value
    itxn
      .assetTransfer({
        assetReceiver: adminAddr,
        assetAmount: amount,
        xferAsset: asset,
        fee: 1000,
      })
      .submit()
  }

  /**
   * Delete a user's box (for cleanup)
   * Can only be called by the box owner or admin
   */
  @abimethod()
  public deleteUserBox(userAddress: Account): void {
    const boxOwner = userAddress
    const adminAddr = this.adminAddress.value

    // Ensure only box owner or admin can delete box
    assert(Txn.sender === boxOwner || Txn.sender === adminAddr, 'Only box owner or admin can delete box')

    // Ensure user has no active stake
    const stakeInfo = this.getUserStakeInfo(userAddress)
    assert(stakeInfo.stakedAmount.native === 0, 'User still has active stake')

    // Delete the box
    const userBox = this.stakers(userAddress)
    if (userBox.exists) {
      userBox.delete()
    }
  }

  /**
   * Update weekly rewards amount (admin only)
   */
  @abimethod()
  public updateWeeklyRewards(newWeeklyRewards: uint64): void {
    // Ensure only admin can update weekly rewards
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === adminAddr, 'Only admin can update weekly rewards')

    // Update rewards before changing the amount
    this.updateRewards()

    // Update weekly rewards
    this.weeklyRewards.value = newWeeklyRewards
  }

  /**
   * Update reward period (admin only)
   */
  @abimethod()
  public updateRewardPeriod(newRewardPeriod: uint64): void {
    // Ensure only admin can update reward period
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === adminAddr, 'Only admin can update reward period')

    // Update rewards before changing the period
    this.updateRewards()

    // Update reward period
    this.rewardPeriod.value = newRewardPeriod
  }
}
