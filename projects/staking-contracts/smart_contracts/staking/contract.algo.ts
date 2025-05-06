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
class UserStakeInfo extends arc4.Struct<{
  // Amount of tokens staked by this user
  stakedAmount: arc4.UintN64
  // Timestamp when user last staked or added to stake
  lastStakeTime: arc4.UintN64
  // Cumulative rewards earned
  totalRewardsEarned: arc4.UintN64
}> {}

/**
 * ASA Staking Contract for Algorand
 *
 * This contract allows users to:
 * - Stake an ASA token
 * - Earn daily rewards that compound automatically
 * - Add to their stake at any time
 * - Withdraw part or all of their stake at any time
 * - Rewards paid out if staked for at least 24 hours before distribution
 *
 * This implementation uses box storage to store user staking information
 */
@contract({ stateTotals: { globalBytes: 7 } })
export class ASAStakingContract extends Contract {
  public assetId = GlobalState<uint64>({ initialValue: 0 })
  public adminAddress = GlobalState<Account>()
  public totalStaked = GlobalState<uint64>({ initialValue: 0 })
  public aprBasisPoints = GlobalState<uint64>({ initialValue: 0 })
  public lastDistributionTime = GlobalState<uint64>({ initialValue: 0 })
  public distributionPeriodSeconds = GlobalState<uint64>({ initialValue: 0 })
  public minimumStake = GlobalState<uint64>({ initialValue: 0 })

  public stakers = BoxMap<Account, UserStakeInfo>({ keyPrefix: 'stakers' })

  /**
   * Helper function to get a user's box name
   * User address is used as the box name for simplicity
   */
  public getUserBoxName(userAddress: Account): arc4.Address {
    const addr = new arc4.Address(userAddress.bytes)
    return addr
  }

  /**
   * Helper function to read user stake info from box storage
   */
  public getUserStakeInfo(userAddress: Account): UserStakeInfo {
    const userBox = this.stakers(userAddress)

    // Check if box exists
    if (userBox.exists) {
      const boxData = userBox.value.copy()

      return boxData
    } else {
      return new UserStakeInfo({
        stakedAmount: new arc4.UintN64(0),
        lastStakeTime: new arc4.UintN64(0),
        totalRewardsEarned: new arc4.UintN64(0),
      })
    }
  }

  /**
   * Helper function to store user stake info in box storage
   */
  public storeUserStakeInfo(userAddress: Account, stakeInfo: UserStakeInfo): void {
    const userBox = this.stakers(userAddress)
    if (userBox.exists) {
      userBox.value = stakeInfo.copy()
    }
  }

  /**
   * Initialize the contract with the ASA token ID and other parameters
   */
  @abimethod()
  public initialize(
    assetId: uint64,
    adminAddress: Account,
    aprBasisPoints: uint64,
    distributionPeriodSeconds: uint64,
    minimumStake: uint64,
  ): void {
    // Ensure this is only called during contract creation
    assert(this.assetId.value === 0, 'Already initialized')

    // Ensure only the creator can initialize
    assert(Txn.sender === Global.creatorAddress, 'Only creator can initialize')

    // Store the initial parameters
    this.assetId.value = assetId
    this.adminAddress.value = adminAddress
    this.totalStaked.value = 0
    this.aprBasisPoints.value = aprBasisPoints
    this.lastDistributionTime.value = Global.latestTimestamp
    this.distributionPeriodSeconds.value = distributionPeriodSeconds
    this.minimumStake.value = minimumStake
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
    const assetId = this.assetId.value
    itxn
      .assetTransfer({
        assetReceiver: Global.currentApplicationAddress,
        assetAmount: 0,
        xferAsset: assetId,
        fee: 1000,
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
    const assetId = this.assetId.value
    const asset = Asset(assetId)
    assert(asset.balance(Global.currentApplicationAddress) >= 0, 'Contract not opted in to ASA')

    // Ensure this call has a companion ASA transfer transaction
    assert(Global.groupSize === 2, 'Expected 2 txns in group')

    // Get the ASA transfer details
    const xferTxn = gtxn.AssetTransferTxn(1)
    assert(xferTxn.type === TransactionType.AssetTransfer, 'Transaction 1 must be asset transfer')
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
    const assetId = this.assetId.value
    itxn
      .assetTransfer({
        assetReceiver: Txn.sender,
        assetAmount: amount,
        xferAsset: assetId,
        fee: 1000,
      })
      .submit()
  }

  /**
   * Distribute rewards to all stakers
   * Only the admin can call this
   * Requires a companion ASA transfer transaction with the rewards
   */
  @abimethod()
  public distributeRewards(): void {
    // Ensure only admin can distribute rewards
    const adminAddr = this.adminAddress.value
    assert(Txn.sender === adminAddr, 'Only admin can distribute rewards')

    // Ensure this call has a companion ASA transfer transaction with rewards
    assert(Global.groupSize === 2, 'Expected 2 txns in group')

    // Get the ASA transfer details
    const asset = Asset(this.assetId.value)
    const xferTxn = gtxn.AssetTransferTxn(1)
    assert(xferTxn.type === TransactionType.AssetTransfer, 'Transaction 1 must be asset transfer')
    assert(xferTxn.assetReceiver === Global.currentApplicationAddress, 'Asset transfer must be to contract')
    assert(xferTxn.assetAmount > 0, 'Must provide non-zero rewards')
    assert(xferTxn.xferAsset === asset, 'Incorrect asset ID')

    // Check if enough time has passed since last distribution
    const currentTime = Global.latestTimestamp
    const lastDistributionTime = this.lastDistributionTime.value
    const periodSeconds = this.distributionPeriodSeconds.value
    assert(currentTime >= lastDistributionTime + periodSeconds, 'Distribution period has not passed')

    // Update last distribution time
    this.lastDistributionTime.value = currentTime

    // Note: Actual reward distribution happens via users claiming rewards
  }

  /**
   * Calculate rewards for a specific user
   * This is a read-only method that doesn't modify state
   */
  @abimethod({ readonly: true })
  public calculateUserRewards(userAddress: Account): uint64 {
    const apr = this.aprBasisPoints.value
    const totalStaked = this.totalStaked.value

    // If no total stake, return 0
    if (totalStaked === 0) {
      return 0
    }

    // Get the user's stake info
    const userAddr = userAddress
    const stakeInfo = this.getUserStakeInfo(userAddr)

    // If user has no stake, return 0
    if (stakeInfo.stakedAmount.native === 0) {
      return 0
    }

    // Get user's stake amount and last stake time
    const userStake = stakeInfo.stakedAmount
    const lastStakeTime = stakeInfo.lastStakeTime

    // Get last distribution time
    const lastDistributionTime = this.lastDistributionTime.value

    // User must have been staked for at least 24 hours before the last distribution
    if (lastStakeTime.native + 86400 > lastDistributionTime) {
      return 0
    }

    // Calculate daily reward based on APR
    // Daily rate = APR / 365 / 10000 (to account for basis points)
    // For a 5% APR (500 basis points), daily rate would be ~0.0137%
    const dailyRateBasisPoints: uint64 = ((apr * 100) / 365) * 10000
    const reward: uint64 = (userStake.native * dailyRateBasisPoints) / 10000

    return reward
  }

  /**
   * Claim rewards for the caller
   * This implements the pull-based reward model
   */
  @abimethod()
  public claimRewards(): void {
    const senderAddress = Txn.sender
    const stakeInfo = this.getUserStakeInfo(senderAddress)

    // Ensure user has a stake
    assert(stakeInfo.stakedAmount.native > 0, 'No stake found')

    // Calculate rewards
    const reward = this.calculateUserRewards(Txn.sender)
    assert(reward > 0, 'No rewards to claim')

    // Update user's staked amount (auto-compound)
    stakeInfo.stakedAmount = new arc4.UintN64(stakeInfo.stakedAmount.native + reward)

    // Update total rewards earned
    stakeInfo.totalRewardsEarned = new arc4.UintN64(stakeInfo.totalRewardsEarned.native + reward)

    // Store updated stake info
    this.storeUserStakeInfo(senderAddress, stakeInfo)

    // Update global staked amount
    this.totalStaked.value = this.totalStaked.value + reward
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
    const userAddr = userAddress
    const stakeInfo = this.getUserStakeInfo(userAddr)
    const result: uint64[] = [
      stakeInfo.stakedAmount.native,
      stakeInfo.lastStakeTime.native,
      stakeInfo.totalRewardsEarned.native,
      this.calculateUserRewards(userAddress),
    ]

    return result
  }

  /**
   * Get contract global statistics
   */
  @abimethod({ readonly: true })
  public getContractStats(): Array<uint64> {
    const result: uint64[] = [
      this.assetId.value,
      this.totalStaked.value,
      this.aprBasisPoints.value,
      this.lastDistributionTime.value,
      this.distributionPeriodSeconds.value,
      this.minimumStake.value,
    ]

    return result
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
    const userAddr = userAddress
    const stakeInfo = this.getUserStakeInfo(userAddr)
    assert(stakeInfo.stakedAmount.native === 0, 'User still has active stake')

    // Delete the box
    const userBox = this.stakers(userAddress)
    if (userBox.exists) {
      userBox.delete()
    }
  }
}
