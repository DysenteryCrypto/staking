import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it, beforeEach } from 'vitest'
import { ASAStakingContract, UserStakeInfo } from './contract.algo'
import { Account, Bytes } from '@algorandfoundation/algorand-typescript'
import { UintN64 } from '@algorandfoundation/algorand-typescript/arc4'
import { DynamicArray } from '@algorandfoundation/algorand-typescript/arc4'

describe('Staking contract', () => {
  const ctx = new TestExecutionContext()

  // Constants for testing
  const WEEKLY_REWARDS = 100_000_000_000 // 100,000 tokens (6 decimals)
  const REWARD_PERIOD = 604_800 // 7 days in seconds

  // Helper function to create a UserStakeInfo with all required fields
  const createUserStakeInfo = (address: Account, stakedAmount: bigint, firstStakeTime: bigint = 0n, lastStakeTime: bigint = 0n, totalRewardsEarned: bigint = 0n, rewardDebt: bigint = 0n, pendingRewards: bigint = 0n) => {
    return new UserStakeInfo({
      address,
      stakedAmount: new UintN64(stakedAmount),
      firstStakeTime: new UintN64(firstStakeTime),
      lastStakeTime: new UintN64(lastStakeTime),
      totalRewardsEarned: new UintN64(totalRewardsEarned),
      rewardDebt: new UintN64(rewardDebt),
      pendingRewards: new UintN64(pendingRewards)
    })
  }

  // Helper function to find a staker in the dynamic array
  const findStakerInArray = (contract: ASAStakingContract, userAddress: Account): UserStakeInfo | null => {
    for (let i = 0; i < contract.stakers.value.length; i++) {
      const staker = contract.stakers.value[i]
      if (staker.address === userAddress) {
        return staker
      }
    }
    return null
  }

  const getStaker = (contract: ASAStakingContract, userAddress: Account): UserStakeInfo | null => {
    for (let i = 0; i < contract.stakers.value.length; i++) {
      const staker = contract.stakers.value[i]
      if (staker.address === userAddress) {
        return staker
      }
    }
    return null
  }

  // Helper function to get staker count
  const getStakerCount = (contract: ASAStakingContract): number => {
    return contract.stakers.value.length
  }

  beforeEach(() => {
    ctx.reset()
  })

  it('Initializes the contract', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()

    contract.initialize(asset, ctx.defaultSender, 1000, WEEKLY_REWARDS, REWARD_PERIOD)

    expect(contract.asset.value).toEqual(asset)
    expect(contract.adminAddress.value).toBe(ctx.defaultSender)
    expect(contract.minimumStake.value).toBe(1000)
    expect(contract.totalStaked.value).toBe(0)
    expect(contract.rewardPool.value).toBe(0)
    expect(contract.accumulatedRewardsPerShare.value).toBe(0)
    expect(contract.weeklyRewards.value).toBe(WEEKLY_REWARDS)
    expect(contract.rewardPeriod.value).toBe(REWARD_PERIOD)
    expect(getStakerCount(contract)).toBe(0)
  })

  it('Cannot initialize twice', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()

    contract.initialize(asset, ctx.defaultSender, 1000, WEEKLY_REWARDS, REWARD_PERIOD)

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: contract })], 0).execute(() => {
      expect(() => contract.initialize(asset, ctx.defaultSender, 1000, WEEKLY_REWARDS, REWARD_PERIOD)).toThrow()
    })
  })

  it('Cannot initialize if not creator', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()
    const nonCreator = ctx.any.account()

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: nonCreator, appId: contract })], 0).execute(() => {
      expect(() => contract.initialize(asset, ctx.defaultSender, 1000, WEEKLY_REWARDS, REWARD_PERIOD)).toThrow()
    })
  })

  it('Cannot opt in to the ASA if not the creator or admin', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()
    const nonAdmin = ctx.any.account()

    contract.initialize(asset, ctx.defaultSender, 1000, WEEKLY_REWARDS, REWARD_PERIOD)

    ctx.txn.createScope(
      [
        ctx.any.txn.applicationCall({
          appId: contract,
          sender: nonAdmin,
          appArgs: [Bytes('optInToAsset')],
        }),
      ],
      1
    )
    .execute(() => {
      expect(() => contract.optInToAsset()).toThrow()
    })
  })

  it('Opt in to the ASA as creator', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()

    contract.initialize(asset, ctx.defaultSender, 1000, WEEKLY_REWARDS, REWARD_PERIOD)
    ctx.ledger.patchAccountData(app.address, {
      account: {
        balance: 10000000000,
      }
    })
    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    expect(contract.asset.value.id).toEqual(asset.id)

    const assetTransferTxn = ctx.txn.lastGroup.lastItxnGroup().getAssetTransferInnerTxn()
    expect(assetTransferTxn.assetAmount).toEqual(0)
    expect(assetTransferTxn.xferAsset).toEqual(asset)
  })

  it('Opt in to the ASA as admin', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const admin = ctx.any.account()

    contract.initialize(asset, admin, 1000, WEEKLY_REWARDS, REWARD_PERIOD)
    ctx.ledger.patchAccountData(app.address, {
      account: {
        balance: 10000000000,
      }
    })
    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: admin, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    expect(contract.asset.value.id).toEqual(asset.id)

    const assetTransferTxn = ctx.txn.lastGroup.lastItxnGroup().getAssetTransferInnerTxn()
    expect(assetTransferTxn.assetAmount).toEqual(0)
    expect(assetTransferTxn.xferAsset).toEqual(asset)
  })

  it('Cannot stake without companion ASA transfer', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      expect(() => contract.stake()).toThrow()
    })
  })

  it("Cannot send incorrect asset", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const otherAsset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n], [otherAsset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000,
      assetSender: sender,
      xferAsset: otherAsset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      expect(() => contract.stake()).toThrow()
    })
  })

  it('Must stake minimum amount for initial stake', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 999, // Below minimum
      assetSender: sender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      expect(() => contract.stake()).toThrow()
    })
  })

  it('Cannot stake zero amount', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 0,
      assetSender: sender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      expect(() => contract.stake()).toThrow()
    })
  })

  it("Can stake initial amount", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: sender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      contract.stake()
    })

    expect(contract.totalStaked.value).toEqual(1000000)
    expect(getStakerCount(contract)).toEqual(1)
    
    const staker = findStakerInArray(contract, sender)
    expect(staker).not.toBeNull()
    expect(staker!.stakedAmount.native.valueOf()).toEqual(1000000n)
    expect(staker!.firstStakeTime.native.valueOf()).toEqual(BigInt(latestTimestamp))
    expect(staker!.lastStakeTime.native.valueOf()).toEqual(BigInt(latestTimestamp))
  })

  it("Can stake additional amount after initial stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens

    // Add initial staker to the array
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(createUserStakeInfo(sender, 1000000n, BigInt(latestTimestamp - 1000), BigInt(latestTimestamp - 1000)))
    contract.totalStaked.value = 1000000

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 500000, // Additional stake
      assetSender: sender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      contract.stake()
    })

    expect(contract.totalStaked.value).toEqual(1500000)
    expect(getStakerCount(contract)).toEqual(1)
    
    const staker = findStakerInArray(contract, sender)
    expect(staker).not.toBeNull()
    expect(staker!.stakedAmount.native.valueOf()).toEqual(1500000n)
    expect(staker!.firstStakeTime.native.valueOf()).toEqual(BigInt(latestTimestamp - 1000)) // Should not change
    expect(staker!.lastStakeTime.native.valueOf()).toEqual(BigInt(latestTimestamp)) // Should update
  })

  it("Can have multiple stakers", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender1 = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const sender2 = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    // First staker
    const txn1 = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: sender1,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn1, ctx.any.txn.applicationCall({ sender: sender1, appId: app }) ], 1).execute(() => {
      contract.stake()
    })

    // Second staker
    const txn2 = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 2000000,
      assetSender: sender2,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn2, ctx.any.txn.applicationCall({ sender: sender2, appId: app }) ], 1).execute(() => {
      contract.stake()
    })

    expect(contract.totalStaked.value).toEqual(3000000)
    expect(getStakerCount(contract)).toEqual(2)
    
    const staker1 = findStakerInArray(contract, sender1)
    const staker2 = findStakerInArray(contract, sender2)
    expect(staker1).not.toBeNull()
    expect(staker2).not.toBeNull()
    expect(staker1!.stakedAmount.native.valueOf()).toEqual(1000000n)
    expect(staker2!.stakedAmount.native.valueOf()).toEqual(2000000n)
  })

  it("Cannot withdraw if not staked", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      expect(() => contract.withdraw(1000000)).toThrow()
    })
  })

  it("Cannot withdraw if less than minimum remaining", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    
    // Add staker to array
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(createUserStakeInfo(sender, 1000n))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      expect(() => contract.withdraw(500)).toThrow()
    })
  })

  it("Cannot withdraw if more than staked", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 2000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    
    // Add staker to array
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(createUserStakeInfo(sender, 2000n))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      expect(() => contract.withdraw(3000)).toThrow()
    })
  })

  it("Cannot withdraw zero amount", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 2000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    
    // Add staker to array
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(createUserStakeInfo(sender, 2000n))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      expect(() => contract.withdraw(0)).toThrow()
    })
  })

  it("Can withdraw full stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    
    // Add staker to array
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(createUserStakeInfo(sender, 1000n))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(0)
    
    const staker = findStakerInArray(contract, sender)
    expect(staker).not.toBeNull()
    expect(staker!.stakedAmount.native.valueOf()).toEqual(0n)

    const assetTransferTxn = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn.assetAmount).toEqual(1000)
    expect(assetTransferTxn.assetReceiver).toEqual(sender)
    expect(assetTransferTxn.assetSender).toEqual(app.address)
    expect(assetTransferTxn.xferAsset).toEqual(asset)
  })

  it("Can withdraw partial stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    
    // Add staker to array
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(createUserStakeInfo(sender, 10000n))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(9000)
    
    const staker = findStakerInArray(contract, sender)
    expect(staker).not.toBeNull()
    expect(staker!.stakedAmount.native.valueOf()).toEqual(9000n)

    const assetTransferTxn = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn.assetAmount).toEqual(1000)
    expect(assetTransferTxn.assetReceiver).toEqual(sender)
    expect(assetTransferTxn.assetSender).toEqual(app.address)
    expect(assetTransferTxn.xferAsset).toEqual(asset)
  })

  it("Can withdraw multiple times", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    
    // Add staker to array
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(createUserStakeInfo(sender, 10000n))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(9000)
    
    const staker = findStakerInArray(contract, sender)
    expect(staker).not.toBeNull()
    expect(staker!.stakedAmount.native.valueOf()).toEqual(9000n)

    const assetTransferTxn = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn.assetAmount).toEqual(1000)
    expect(assetTransferTxn.assetReceiver).toEqual(sender)
    expect(assetTransferTxn.assetSender).toEqual(app.address)
    expect(assetTransferTxn.xferAsset).toEqual(asset)

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      contract.withdraw(9000)
    })

    expect(contract.totalStaked.value).toEqual(0)
    
    const stakerAfter = findStakerInArray(contract, sender)
    expect(stakerAfter).not.toBeNull()
    expect(stakerAfter!.stakedAmount.native.valueOf()).toEqual(0n)

    const assetTransferTxn2 = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn2.assetAmount).toEqual(9000)
    expect(assetTransferTxn2.assetReceiver).toEqual(sender)
    expect(assetTransferTxn2.assetSender).toEqual(app.address)
    expect(assetTransferTxn2.xferAsset).toEqual(asset)
  })

  it("allows multiple withdrawals from different stakers", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker1 = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    const staker2 = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    
    // Add stakers to array
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(createUserStakeInfo(staker1, 5000n))
    contract.stakers.value.push(createUserStakeInfo(staker2, 5000n))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: staker1, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(9000)
    
    const staker1Info = findStakerInArray(contract, staker1)
    expect(staker1Info).not.toBeNull()
    expect(staker1Info!.stakedAmount.native.valueOf()).toEqual(4000n)

    const assetTransferTxn1 = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn1.assetAmount).toEqual(1000)
    expect(assetTransferTxn1.assetReceiver).toEqual(staker1)
    expect(assetTransferTxn1.assetSender).toEqual(app.address)
    expect(assetTransferTxn1.xferAsset).toEqual(asset)

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: staker2, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(8000)
    
    const staker2Info = findStakerInArray(contract, staker2)
    expect(staker2Info).not.toBeNull()
    expect(staker2Info!.stakedAmount.native.valueOf()).toEqual(4000n)

    const assetTransferTxn2 = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn2.assetAmount).toEqual(1000)
    expect(assetTransferTxn2.assetReceiver).toEqual(staker2)
    expect(assetTransferTxn2.assetSender).toEqual(app.address)
    expect(assetTransferTxn2.xferAsset).toEqual(asset)
  })

  it("must be admin to add rewards", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 1000000]]) })
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: sender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      expect(() => contract.addRewards()).toThrow()
    })
  })

  it("must include companion ASA transfer", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      expect(() => contract.addRewards()).toThrow()
    })
  })

  it("must transfer asset amount greater than 0", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 0,
      assetSender: ctx.defaultSender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 1).execute(() => {
      expect(() => contract.addRewards()).toThrow()
    })
  })

  it("can add rewards", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.rewardPool.value = 0

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: ctx.defaultSender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 1).execute(() => {
      contract.addRewards()
    })

    expect(contract.rewardPool.value).toEqual(1000000)

    const txn2 = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 5,
      assetSender: ctx.defaultSender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn2, ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 1).execute(() => {
      contract.addRewards()
    })

    expect(contract.rewardPool.value).toEqual(1000005)
  })

  it("can calculate current APY", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    
    contract.asset.value = asset
    contract.totalStaked.value = 0
    contract.weeklyRewards.value = WEEKLY_REWARDS

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      const apy = contract.getCurrentAPY()
      expect(apy).toEqual(0) // No tokens staked
    })

    // Set total staked to 1,000,000 tokens (with 6 decimals = 1,000,000,000,000)
    contract.totalStaked.value = 1000000000000

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      const apy = contract.getCurrentAPY()
      // APY = (52 * 100,000,000,000 / 1,000,000,000,000) * 10000 = 520 basis points = 5.2%
      expect(apy).toEqual(520)
    })
  })

  it("can get pending rewards for user with no stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    
    contract.asset.value = asset
    contract.totalStaked.value = 10000

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      const pendingRewards = contract.getPendingRewards(staker)
      expect(pendingRewards).toEqual(0)
    })
  })

  it("can get pending rewards for user with stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    
    contract.asset.value = asset
    contract.totalStaked.value = 10000
    contract.accumulatedRewardsPerShare.value = 1 // 1 reward per token
    contract.stakers.value = new DynamicArray<UserStakeInfo>()
    contract.stakers.value.push(new UserStakeInfo({ 
      address: staker,
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0),
      pendingRewards: new UintN64(0)
    }))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      const pendingRewards = contract.getPendingRewards(staker)
      // 5000 * 1 - 0 = 5000
      expect(pendingRewards.valueOf()).toEqual(5000n)
    })
  })

  it("admin can trigger reward distribution", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.totalStaked.value = 10000
    contract.rewardPool.value = WEEKLY_REWARDS // 100,000 tokens
    contract.lastRewardTime.value = 0
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD

    // Set current time to 7 days later
    ctx.ledger.patchGlobalData({
      latestTimestamp: REWARD_PERIOD, // 7 days in seconds
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.triggerRewardDistribution()
    })

    // Check that accumulated rewards per share was updated
    expect(contract.accumulatedRewardsPerShare.value).toBeGreaterThan(0)
    expect(contract.lastRewardTime.value).toEqual(REWARD_PERIOD)
  })

  it("non-admin cannot trigger reward distribution", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const nonAdmin = ctx.any.account()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: nonAdmin, appId: app }) ], 0).execute(() => {
      expect(() => contract.triggerRewardDistribution()).toThrow()
    })
  })

  it("can get user stats", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    
    contract.asset.value = asset
    contract.totalStaked.value = 10000
    contract.accumulatedRewardsPerShare.value = 1
    contract.stakers.value.push(new UserStakeInfo({ 
      address: staker,
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0),
      pendingRewards: new UintN64(0)
    }))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      const stats = contract.getUserStats(staker)
      expect(stats.length).toEqual(7)
      expect(stats[0].valueOf()).toEqual(5000n) // stakedAmount
      expect(stats[1].valueOf()).toEqual(100n)  // firstStakeTime
      expect(stats[2].valueOf()).toEqual(200n)  // lastStakeTime
      expect(stats[3].valueOf()).toEqual(1000n) // totalRewardsEarned
      expect(stats[4].valueOf()).toEqual(5000n) // rewardDebt
      expect(stats[5].valueOf()).toEqual(0n)    // pendingRewards
    })
  })

  it("can get contract stats", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    
    contract.asset.value = asset
    contract.totalStaked.value = 1000000000000 // 1M tokens
    contract.lastRewardTime.value = 100
    contract.minimumStake.value = 1000
    contract.rewardPool.value = 50000
    contract.accumulatedRewardsPerShare.value = 123456
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      const stats = contract.getContractStats()
      expect(stats.length).toEqual(8)
      expect(stats[0]).toEqual(asset.id) // asset.id
      expect(stats[1]).toEqual(1000000000000) // totalStaked
      expect(stats[2]).toEqual(520) // currentAPY (5.2%)
      expect(stats[3]).toEqual(100) // lastRewardTime
      expect(stats[4]).toEqual(REWARD_PERIOD) // rewardPeriod
      expect(stats[5]).toEqual(1000) // minimumStake
      expect(stats[6]).toEqual(50000) // rewardPool
      expect(stats[7]).toEqual(123456) // accumulatedRewardsPerShare
    })
  })

  it("admin can update weekly rewards", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const newWeeklyRewards = 200_000_000_000 // 200,000 tokens
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.updateWeeklyRewards(newWeeklyRewards)
    })

    expect(contract.weeklyRewards.value).toEqual(newWeeklyRewards)
  })

  it("non-admin cannot update weekly rewards", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const nonAdmin = ctx.any.account()
    const newWeeklyRewards = 200_000_000_000
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.weeklyRewards.value = WEEKLY_REWARDS

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: nonAdmin, appId: app }) ], 0).execute(() => {
      expect(() => contract.updateWeeklyRewards(newWeeklyRewards)).toThrow()
    })
  })

  it("admin can update reward period", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const newRewardPeriod = 1209600 // 14 days in seconds
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.updateRewardPeriod(newRewardPeriod)
    })

    expect(contract.rewardPeriod.value).toEqual(newRewardPeriod)
  })

  it("non-admin cannot update reward period", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const nonAdmin = ctx.any.account()
    const newRewardPeriod = 1209600
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.rewardPeriod.value = REWARD_PERIOD

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: nonAdmin, appId: app }) ], 0).execute(() => {
      expect(() => contract.updateRewardPeriod(newRewardPeriod)).toThrow()
    })
  })

  it("can emergency withdraw rewards", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.rewardPool.value = 10000

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.emergencyWithdrawRewards(5000)
    })

    expect(contract.rewardPool.value).toEqual(5000)
    
    const assetTransferTxn = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn.assetAmount).toEqual(5000)
    expect(assetTransferTxn.assetReceiver).toEqual(ctx.defaultSender)
    expect(assetTransferTxn.xferAsset).toEqual(asset)
  })

  it("non-admin cannot emergency withdraw", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const nonAdmin = ctx.any.account()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.rewardPool.value = 10000

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: nonAdmin, appId: app }) ], 0).execute(() => {
      expect(() => contract.emergencyWithdrawRewards(5000)).toThrow()
    })
  })

  it("can delete user box", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const user = ctx.any.account()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.stakers.value.push(new UserStakeInfo({ 
      address: user,
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0),
      pendingRewards: new UintN64(0)
    }))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: user, appId: app }) ], 0).execute(() => {
      contract.deleteUserBox(user)
    })

    const idx = findStakerInArray(contract, user)
    expect(idx).toBeNull()
  })

  it("cannot delete user box with active stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const user = ctx.any.account()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.stakers.value.push(new UserStakeInfo({ 
      address: user,
      stakedAmount: new UintN64(1000), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0),
      pendingRewards: new UintN64(0)
    }))

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: user, appId: app }) ], 0).execute(() => {
      expect(() => contract.deleteUserBox(user)).toThrow()
    })
  })

  it("compounds rewards during distribution", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker1 = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const staker2 = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    contract.totalStaked.value = 2000000
    contract.accumulatedRewardsPerShare.value = 1 // 1 reward per token

    // Set up initial stakes
    contract.stakers.value.push(new UserStakeInfo({ 
      address: staker1,
      stakedAmount: new UintN64(1000000), 
      firstStakeTime: new UintN64(latestTimestamp - REWARD_PERIOD),
      lastStakeTime: new UintN64(latestTimestamp - REWARD_PERIOD), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0),
      pendingRewards: new UintN64(0)
    }))
    contract.stakers.value.push(new UserStakeInfo({ 
      address: staker2,
      stakedAmount: new UintN64(1000000), 
      firstStakeTime: new UintN64(latestTimestamp - REWARD_PERIOD),
      lastStakeTime: new UintN64(latestTimestamp - REWARD_PERIOD), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0),
      pendingRewards: new UintN64(0)
    }))

    // Add more stake to staker1
    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: staker1,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender: staker1, appId: app }) ], 1).execute(() => {
      contract.stake()
    })

    // Check that rewards were not compounded during stake
    const stakeInfo1 = getStaker(contract, staker1)
    expect(stakeInfo1).not.toBeNull()
    expect(stakeInfo1!.stakedAmount.native.valueOf()).toEqual(2000000n) // Should be exactly the new stake amount
    expect(stakeInfo1!.totalRewardsEarned.native.valueOf()).toEqual(0n)

    // Trigger reward distribution
    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.triggerRewardDistribution()
    })

    // Check that rewards were compounded during distribution
    const stakeInfo1After = getStaker(contract, staker1)
    const stakeInfo2After = getStaker(contract, staker2)
    expect(stakeInfo1After).not.toBeNull()
    expect(stakeInfo2After).not.toBeNull()
    expect(stakeInfo1After!.stakedAmount.native.valueOf()).toBeGreaterThan(2000000n) // Should be more than just the stake
    expect(stakeInfo2After!.stakedAmount.native.valueOf()).toBeGreaterThan(1000000n) // Should be more than just the stake
    expect(stakeInfo1After!.totalRewardsEarned.native.valueOf()).toBeGreaterThan(0n)
    expect(stakeInfo2After!.totalRewardsEarned.native.valueOf()).toBeGreaterThan(0n)
  })

  it("tracks rewards separately from stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    contract.totalStaked.value = 1000000
    contract.accumulatedRewardsPerShare.value = 1 // 1 reward per token

    // Set up initial stake
    contract.stakers.value.push(new UserStakeInfo({ 
      address: staker,
      stakedAmount: new UintN64(1000000), 
      firstStakeTime: new UintN64(latestTimestamp - REWARD_PERIOD),
      lastStakeTime: new UintN64(latestTimestamp - REWARD_PERIOD), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0),
      pendingRewards: new UintN64(0)
    }))

    // Add more stake
    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: staker,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender: staker, appId: app }) ], 1).execute(() => {
      contract.stake()
    })

    // Check that stake increased but rewards weren't compounded
    const stakeInfo = getStaker(contract, staker)
    expect(stakeInfo).not.toBeNull()
    expect(stakeInfo!.stakedAmount.native.valueOf()).toEqual(2000000n) // Should be exactly the new stake amount
    expect(stakeInfo!.totalRewardsEarned.native.valueOf()).toEqual(0n)
    expect(stakeInfo!.pendingRewards.native.valueOf()).toEqual(0n)

    // Trigger reward distribution
    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.triggerRewardDistribution()
    })

    // Check that rewards were compounded during distribution
    const stakeInfoAfter = getStaker(contract, staker)
    expect(stakeInfoAfter).not.toBeNull()
    expect(stakeInfoAfter!.stakedAmount.native.valueOf()).toBeGreaterThan(2000000n) // Should be more than just the stake
    expect(stakeInfoAfter!.totalRewardsEarned.native.valueOf()).toBeGreaterThan(0n)
    expect(stakeInfoAfter!.pendingRewards.native.valueOf()).toEqual(0n)
  })

  it("maintains accurate reward tracking during multiple distributions", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const latestTimestamp = ctx.any.uint64(1746057600, 1748995200)

    ctx.ledger.patchGlobalData({
      latestTimestamp,
    })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.lastRewardTime.value = latestTimestamp - REWARD_PERIOD
    contract.rewardPool.value = 100_000_000_000_000_000 // 100B tokens
    contract.totalStaked.value = 1000000
    contract.accumulatedRewardsPerShare.value = 1 // 1 reward per token

    // Set up initial stake
    contract.stakers.value.push(new UserStakeInfo({ 
      address: staker,
      stakedAmount: new UintN64(1000000), 
      firstStakeTime: new UintN64(latestTimestamp - REWARD_PERIOD),
      lastStakeTime: new UintN64(latestTimestamp - REWARD_PERIOD), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0),
      pendingRewards: new UintN64(0)
    }))

    // First distribution
    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.triggerRewardDistribution()
    })

    const stakeInfo1 = getStaker(contract, staker)
    expect(stakeInfo1).not.toBeNull()
    const firstRewards = stakeInfo1!.totalRewardsEarned.native.valueOf()

    // Advance time by one period
    ctx.ledger.patchGlobalData({
      latestTimestamp: latestTimestamp + REWARD_PERIOD,
    })

    // Second distribution
    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.triggerRewardDistribution()
    })

    const stakeInfo2 = getStaker(contract, staker)
    expect(stakeInfo2).not.toBeNull()
    const secondRewards = stakeInfo2!.totalRewardsEarned.native.valueOf() - firstRewards

    // Verify that rewards are being tracked correctly
    expect(stakeInfo2!.stakedAmount.native.valueOf()).toBeGreaterThan(stakeInfo1!.stakedAmount.native.valueOf())
    expect(secondRewards).toBeGreaterThan(0n)
    expect(stakeInfo2!.pendingRewards.native.valueOf()).toEqual(0n)
  })
})