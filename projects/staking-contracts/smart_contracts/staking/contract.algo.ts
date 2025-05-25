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
  // Timestamp when user last staked or added to stake
  lastStakeTime: arc4.UintN64
  // Cumulative rewards earned
  totalRewardsEarned: arc4.UintN64
  // Last distribution period when user claimed rewards
  lastClaimedPeriod: arc4.UintN64
}> {}

/**
 * ASA Staking Contract for Algorand with Auto-Compounding
 *
 * This contract allows users to:
 * - Stake an ASA token
 * - Earn rewards that compound automatically when claimed
 * - Add to their stake at any time
 * - Withdraw part or all of their stake at any time
 * - Rewards are calculated based on APR and distributed from a reward pool
 *
 * This implementation uses box storage to store user staking information
 */
@contract({ stateTotals: { globalBytes: 8 } })
export class ASAStakingContract extends Contract {
  public asset = GlobalState<Asset>({ initialValue: Asset() })
  public adminAddress = GlobalState<Account>({ initialValue: Account()})
  public totalStaked = GlobalState<uint64>({ initialValue: 0 })
  public aprBasisPoints = GlobalState<uint64>({ initialValue: 0 })
  public lastDistributionTime = GlobalState<uint64>({ initialValue: 0 })
  public distributionPeriodSeconds = GlobalState<uint64>({ initialValue: 0 })
  public minimumStake = GlobalState<uint64>({ initialValue: 0 })
  public rewardPool = GlobalState<uint64>({ initialValue: 0 })

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
        lastStakeTime: new arc4.UintN64(0),
        totalRewardsEarned: new arc4.UintN64(0),
        lastClaimedPeriod: new arc4.UintN64(0),
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
   * Calculate the current distribution period
   */
  public getCurrentPeriod(): uint64 {
    const periodSeconds = this.distributionPeriodSeconds.value
    if (periodSeconds === 0) return 0
    return Global.latestTimestamp / periodSeconds
  }

  /**
   * Initialize the contract with the ASA token ID and other parameters
   */
  @abimethod()
  public initialize(
    asset: Asset,
    adminAddress: Account,
    aprBasisPoints: uint64,
    distributionPeriodSeconds: uint64,
    minimumStake: uint64,
  ): void {
    // Ensure this is only called during contract creation
    assert(this.asset.value === Asset(), 'Already initialized')

    // Ensure only the creator can initialize
    assert(Txn.sender === Global.creatorAddress, 'Only creator can initialize')

    // Store the initial parameters
    this.asset.value = asset
    this.adminAddress.value = adminAddress
    this.totalStaked.value = 0
    this.aprBasisPoints.value = aprBasisPoints
    this.lastDistributionTime.value = Global.latestTimestamp
    this.distributionPeriodSeconds.value = distributionPeriodSeconds
    this.minimumStake.value = minimumStake
    this.rewardPool.value = 0
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

    // Get the current user stake info
    const senderAddress = Txn.sender
    const stakeInfo = this.getUserStakeInfo(senderAddress)

    // If this is a new stake, ensure it meets minimum
    if (stakeInfo.stakedAmount.native === 0) {
      assert(stakeAmount >= minimumStake, 'Initial stake below minimum')
      // Set the initial claim period to current period
      stakeInfo.lastClaimedPeriod = new arc4.UintN64(this.getCurrentPeriod())
    }

    // Update stake info
    stakeInfo.stakedAmount = new arc4.UintN64(stakeInfo.stakedAmount.native + stakeAmount)
    stakeInfo.lastStakeTime = new arc4.UintN64(Global.latestTimestamp)

    // Store updated stake info
    this.storeUserStakeInfo(senderAddress, stakeInfo)

    // Update global state
    this.totalStaked.value = this.totalStaked.value + stakeAmount
  }

  /**
   * Withdraw staked tokens
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

    // Store updated stake info
    this.storeUserStakeInfo(senderAddress, stakeInfo)

    // Update global state
    this.totalStaked.value = this.totalStaked.value - amount

    // Transfer tokens back to user
    const asset = this.asset.value
    itxn
      .assetTransfer({
        assetReceiver: Txn.sender,
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

    // Update last distribution time
    this.lastDistributionTime.value = Global.latestTimestamp
  }

  /**
   * Calculate rewards for a specific user for a given period
   * This calculates rewards per distribution period
   */
  @abimethod({ readonly: true })
  public calculateUserRewardsForPeriod(userAddress: Account): uint64 {
    const apr = this.aprBasisPoints.value
    const totalStaked = this.totalStaked.value
    const periodSeconds = this.distributionPeriodSeconds.value

    // If no total stake or no period defined, return 0
    if (totalStaked === 0 || periodSeconds === 0) {
      return 0
    }

    // Get the user's stake info
    const stakeInfo = this.getUserStakeInfo(userAddress)

    // If user has no stake, return 0
    if (stakeInfo.stakedAmount.native === 0) {
      return 0
    }

    // Get user's stake amount and last stake time
    const userStake = stakeInfo.stakedAmount.native
    const lastStakeTime = stakeInfo.lastStakeTime.native

    // Check if user has been staked for the minimum period
    const minimumStakeTime: uint64 = 86400 // 24 hours in seconds
    if (Global.latestTimestamp < lastStakeTime + minimumStakeTime) {
      return 0
    }

    // Calculate reward rate for the period
    // APR is in basis points (e.g., 500 = 5%)
    // Convert APR to period rate: (APR / 10000) * (periodSeconds / 31536000)
    // where 31536000 is seconds in a year
    const yearInSeconds: uint64 = 31536000
    const periodRateNumerator: uint64 = apr * periodSeconds
    const periodRateDenominator: uint64 = 10000 * yearInSeconds

    // Calculate reward: userStake * periodRate
    const reward: uint64 = (userStake * periodRateNumerator) / periodRateDenominator

    return reward
  }

  /**
   * Calculate pending rewards for a user since their last claim
   */
  @abimethod({ readonly: true })
  public calculatePendingRewards(userAddress: Account): uint64 {
    const stakeInfo = this.getUserStakeInfo(userAddress)
    
    if (stakeInfo.stakedAmount.native === 0) {
      return 0
    }

    const currentPeriod = this.getCurrentPeriod()
    const lastClaimedPeriod = stakeInfo.lastClaimedPeriod.native
    
    // Calculate periods since last claim
    const periodsSinceLastClaim: uint64 = currentPeriod > lastClaimedPeriod ? currentPeriod - lastClaimedPeriod : 0
    
    if (periodsSinceLastClaim === 0) {
      return 0
    }

    // Calculate reward per period
    const rewardPerPeriod = this.calculateUserRewardsForPeriod(userAddress)
    
    return rewardPerPeriod * periodsSinceLastClaim
  }

  /**
   * Claim rewards for the caller with auto-compounding
   * This implements the pull-based reward model with automatic compounding
   */
  @abimethod()
  public claimRewards(): void {
    const senderAddress = Txn.sender
    const stakeInfo = this.getUserStakeInfo(senderAddress)

    // Ensure user has a stake
    assert(stakeInfo.stakedAmount.native > 0, 'No stake found')

    // Calculate pending rewards
    const pendingRewards = this.calculatePendingRewards(senderAddress)
    assert(pendingRewards > 0, 'No rewards to claim')

    // Ensure reward pool has sufficient funds
    assert(this.rewardPool.value >= pendingRewards, 'Insufficient reward pool')

    // Auto-compound: Add rewards to staked amount
    stakeInfo.stakedAmount = new arc4.UintN64(stakeInfo.stakedAmount.native + pendingRewards)

    // Update total rewards earned
    stakeInfo.totalRewardsEarned = new arc4.UintN64(stakeInfo.totalRewardsEarned.native + pendingRewards)

    // Update last claimed period to current period
    stakeInfo.lastClaimedPeriod = new arc4.UintN64(this.getCurrentPeriod())

    // Store updated stake info
    this.storeUserStakeInfo(senderAddress, stakeInfo)

    // Update global state
    this.totalStaked.value = this.totalStaked.value + pendingRewards
    this.rewardPool.value = this.rewardPool.value - pendingRewards
  }

  /**
   * Update the APR basis points
   * Only the admin can call this
   */
  @abimethod()
  public updateAPR(newAprBasisPoints: uint64): void {
    // Ensure only admin can update APR
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === adminAddr, 'Only admin can update APR')

    // Update APR
    this.aprBasisPoints.value = newAprBasisPoints
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
      stakeInfo.lastStakeTime.native,
      stakeInfo.totalRewardsEarned.native,
      pendingRewards,
      stakeInfo.lastClaimedPeriod.native,
    ]

    return result
  }

  /**
   * Get contract global statistics
   */
  @abimethod({ readonly: true })
  public getContractStats(): Array<uint64> {
    const result: uint64[] = [
      this.asset.value.id,
      this.totalStaked.value,
      this.aprBasisPoints.value,
      this.lastDistributionTime.value,
      this.distributionPeriodSeconds.value,
      this.minimumStake.value,
      this.rewardPool.value,
      this.getCurrentPeriod(),
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
}