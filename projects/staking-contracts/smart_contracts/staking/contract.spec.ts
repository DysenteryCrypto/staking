import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it, beforeEach } from 'vitest'
import { ASAStakingContract, UserStakeInfo } from './contract.algo'
import { Bytes } from '@algorandfoundation/algorand-typescript'
import { UintN64 } from '@algorandfoundation/algorand-typescript/arc4'

describe('Staking contract', () => {
  const ctx = new TestExecutionContext()

  // Constants for testing
  const WEEKLY_REWARDS = 100_000_000_000 // 100,000 tokens (6 decimals)
  const REWARD_PERIOD = 604_800 // 7 days in seconds
  const PRECISION = 1_000_000 // Reduced precision from 1e12 to 1e6

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
    expect(contract.precision.value).toBe(PRECISION)
  })

  it('Cannot opt in to the ASA if not the creator', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()

    contract.initialize(asset, ctx.defaultSender, 1000, WEEKLY_REWARDS, REWARD_PERIOD)

    ctx.txn.createScope(
      [
        ctx.any.txn.applicationCall({
          appId: contract,
          sender: ctx.any.account(),
          appArgs: [Bytes('optInToAsset')],
        }),
      ],
      1
    )
    .execute(() => {
      expect(() => contract.optInToAsset()).toThrow()
    })
  })

  it('Opt in to the ASA', () => {
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
    contract.precision.value = PRECISION

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
    contract.precision.value = PRECISION

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

  it('Must stake minimum amount', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1,
      assetSender: sender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      expect(() => contract.stake()).toThrow()
    })
  })

  it("Can stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION

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
    expect(contract.stakers.length).toEqual(1)
    expect(contract.stakers(sender).exists).toEqual(true)
    expect(contract.stakers(sender).value.stakedAmount.native.valueOf()).toEqual(1000000n)
  })

  it("Can stake multiple times", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION

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
    expect(contract.stakers.length).toEqual(1)
    expect(contract.stakers(sender).exists).toEqual(true)
    expect(contract.stakers(sender).value.stakedAmount.native.valueOf()).toEqual(1000000n)

    const txn2 = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: sender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn2, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      contract.stake()
    })

    expect(contract.totalStaked.value).toEqual(2000000)
    expect(contract.stakers.length).toEqual(1)
    expect(contract.stakers(sender).exists).toEqual(true)
    expect(contract.stakers(sender).value.stakedAmount.native.valueOf()).toEqual(2000000n)
  })

  it("Can have multiple stakers", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })
    const sender2 = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION

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

    const txn2 = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: sender2,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn2, ctx.any.txn.applicationCall({ sender: sender2, appId: app }) ], 1).execute(() => {
      contract.stake()
    })

    expect(contract.totalStaked.value).toEqual(2000000)
    expect(contract.stakers(sender).exists).toEqual(true)
    expect(contract.stakers(sender).value.stakedAmount.native.valueOf()).toEqual(1000000n)
    expect(contract.stakers(sender2).exists).toEqual(true)
    expect(contract.stakers(sender2).value.stakedAmount.native.valueOf()).toEqual(1000000n)
  })

  it("Cannot withdraw if not staked", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION
    contract.stakers(sender).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(0), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0) 
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      expect(() => contract.withdraw(1000000)).toThrow()
    })
  })

  it("Cannot withdraw if less than minimum remaining", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION
    contract.stakers(sender).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(1000), 
      firstStakeTime: new UintN64(0), 
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0) 
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      expect(() => contract.withdraw(500)).toThrow()
    })
  })

  it("Cannot withdraw if more than staked", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 10000000000n]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 2000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION
    contract.stakers(sender).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(2000), 
      firstStakeTime: new UintN64(0), 
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0) 
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      expect(() => contract.withdraw(3000)).toThrow()
    })
  })

  it("Can withdraw stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 1000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION
    contract.stakers(sender).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(1000), 
      firstStakeTime: new UintN64(0), 
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0) 
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(0)
    expect(contract.stakers(sender).exists).toEqual(true)
    expect(contract.stakers(sender).value.stakedAmount.native.valueOf()).toEqual(0n)

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

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION
    contract.stakers(sender).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(10000), 
      firstStakeTime: new UintN64(0), 
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0) 
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(9000)
    expect(contract.stakers(sender).exists).toEqual(true)
    expect(contract.stakers(sender).value.stakedAmount.native.valueOf()).toEqual(9000n)

    const assetTransferTxn = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn.assetAmount).toEqual(1000)
    expect(assetTransferTxn.assetReceiver).toEqual(sender)
    expect(assetTransferTxn.assetSender).toEqual(app.address)
    expect(assetTransferTxn.xferAsset).toEqual(asset)
  })

  it("Can withdraw multiple times stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const sender = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION
    contract.stakers(sender).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(10000), 
      firstStakeTime: new UintN64(0), 
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0) 
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(9000)
    expect(contract.stakers(sender).exists).toEqual(true)
    expect(contract.stakers(sender).value.stakedAmount.native.valueOf()).toEqual(9000n)

    const assetTransferTxn = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn.assetAmount).toEqual(1000)
    expect(assetTransferTxn.assetReceiver).toEqual(sender)
    expect(assetTransferTxn.assetSender).toEqual(app.address)
    expect(assetTransferTxn.xferAsset).toEqual(asset)

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
      contract.withdraw(9000)
    })

    expect(contract.totalStaked.value).toEqual(0)
    expect(contract.stakers(sender).exists).toEqual(true)
    expect(contract.stakers(sender).value.stakedAmount.native.valueOf()).toEqual(0n)

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

    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.weeklyRewards.value = WEEKLY_REWARDS
    contract.rewardPeriod.value = REWARD_PERIOD
    contract.precision.value = PRECISION
    contract.stakers(staker1).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(0), 
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0) 
    })
    contract.stakers(staker2).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(0), 
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0) 
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: staker1, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(9000)
    expect(contract.stakers(staker1).exists).toEqual(true)
    expect(contract.stakers(staker1).value.stakedAmount.native.valueOf()).toEqual(4000n)

    const assetTransferTxn1 = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn1.assetAmount).toEqual(1000)
    expect(assetTransferTxn1.assetReceiver).toEqual(staker1)
    expect(assetTransferTxn1.assetSender).toEqual(app.address)
    expect(assetTransferTxn1.xferAsset).toEqual(asset)

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: staker2, appId: app }) ], 0).execute(() => {
      contract.withdraw(1000)
    })

    expect(contract.totalStaked.value).toEqual(8000)
    expect(contract.stakers(staker2).exists).toEqual(true)
    expect(contract.stakers(staker2).value.stakedAmount.native.valueOf()).toEqual(4000n)

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
    contract.accumulatedRewardsPerShare.value = PRECISION // 1e6 precision
    contract.stakers(staker).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0)
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      const pendingRewards = contract.getPendingRewards(staker)
      // (5000 * 1e6) / 1e6 - 0 = 5000
      expect(pendingRewards).toEqual(5000)
    })
  })

  it("can claim rewards", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    
    contract.asset.value = asset
    contract.totalStaked.value = 10000
    contract.rewardPool.value = 10000
    contract.accumulatedRewardsPerShare.value = PRECISION // 1e6 precision
    contract.stakers(staker).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0)
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: staker, appId: app }) ], 0).execute(() => {
      contract.claimRewards()
    })

    // Check that rewards were claimed
    expect(contract.rewardPool.value).toEqual(5000) // 10000 - 5000
    expect(contract.stakers(staker).value.totalRewardsEarned.native.valueOf()).toEqual(5000n)
    
    // Check asset transfer
    const assetTransferTxn = ctx.txn.lastGroup.getItxnGroup(0).getAssetTransferInnerTxn(0)
    expect(assetTransferTxn.assetAmount).toEqual(5000)
    expect(assetTransferTxn.assetReceiver).toEqual(staker)
    expect(assetTransferTxn.xferAsset).toEqual(asset)
  })

  it("cannot claim rewards with no stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    
    contract.asset.value = asset
    contract.totalStaked.value = 10000
    contract.rewardPool.value = 10000

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: staker, appId: app }) ], 0).execute(() => {
      expect(() => contract.claimRewards()).toThrow()
    })
  })

  it("cannot claim rewards with no pending rewards", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const staker = ctx.any.account({ optedAssetBalances: new Map([[asset.id, 0]]) })
    
    contract.asset.value = asset
    contract.totalStaked.value = 10000
    contract.rewardPool.value = 10000
    contract.accumulatedRewardsPerShare.value = PRECISION // 1e6 precision
    contract.stakers(staker).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(5000000000) // Already claimed all rewards: 5000 * 1e6
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: staker, appId: app }) ], 0).execute(() => {
      expect(() => contract.claimRewards()).toThrow()
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
    contract.precision.value = PRECISION

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
    contract.accumulatedRewardsPerShare.value = PRECISION
    contract.stakers(staker).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(5000), 
      firstStakeTime: new UintN64(100),
      lastStakeTime: new UintN64(200), 
      totalRewardsEarned: new UintN64(1000), 
      rewardDebt: new UintN64(0)
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      const stats = contract.getUserStats(staker)
      expect(stats.length).toEqual(6)
      expect(stats[0]).toEqual(5000) // stakedAmount
      expect(stats[1]).toEqual(100)  // firstStakeTime
      expect(stats[2]).toEqual(200)  // lastStakeTime
      expect(stats[3]).toEqual(1000) // totalRewardsEarned
      expect(stats[4]).toEqual(5000) // pendingRewards
      expect(stats[5]).toEqual(0)    // rewardDebt
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
    contract.precision.value = PRECISION

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
    contract.precision.value = PRECISION

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
    contract.stakers(user).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(0), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0)
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: user, appId: app }) ], 0).execute(() => {
      contract.deleteUserBox(user)
    })

    expect(contract.stakers(user).exists).toEqual(false)
  })

  it("cannot delete user box with active stake", () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const app = ctx.ledger.getApplicationForContract(contract)
    const asset = ctx.any.asset()
    const user = ctx.any.account()
    
    contract.asset.value = asset
    contract.adminAddress.value = ctx.defaultSender
    contract.stakers(user).value = new UserStakeInfo({ 
      stakedAmount: new UintN64(1000), 
      firstStakeTime: new UintN64(0),
      lastStakeTime: new UintN64(0), 
      totalRewardsEarned: new UintN64(0), 
      rewardDebt: new UintN64(0)
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: user, appId: app }) ], 0).execute(() => {
      expect(() => contract.deleteUserBox(user)).toThrow()
    })
  })
})
