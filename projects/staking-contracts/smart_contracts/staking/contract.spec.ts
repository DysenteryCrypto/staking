import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it, beforeEach } from 'vitest'
import { ASAStakingContract, UserStakeInfo } from './contract.algo'
import { Bytes } from '@algorandfoundation/algorand-typescript'
import { UintN64 } from '@algorandfoundation/algorand-typescript/arc4'

describe('Staking contract', () => {
  const ctx = new TestExecutionContext()

  beforeEach(() => {
    ctx.reset()
  })

  it('Initializes the contract', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()

    contract.initialize(asset, ctx.defaultSender, 10000, 60 * 60 * 24, 1000)

    expect(contract.asset.value).toEqual(asset)
    expect(contract.adminAddress.value).toBe(ctx.defaultSender)
    expect(contract.aprBasisPoints.value).toBe(10000)
    expect(contract.distributionPeriodSeconds.value).toBe(60 * 60 * 24)
    expect(contract.minimumStake.value).toBe(1000)
  })

  it('Cannot opt in to the ASA if not the creator', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()

    contract.initialize(asset, ctx.defaultSender, 10000, 60 * 60 * 24, 1000)

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

    contract.initialize(asset, ctx.defaultSender, 10000, 60 * 60 * 24, 1000)
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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: ctx.defaultSender, appId: app }) ], 0).execute(() => {
      contract.optInToAsset()
    })

    ctx.txn.createScope([ctx.any.txn.applicationCall({ sender, appId: app }) ], 0).execute(() => {
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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000
    contract.stakers(sender).value = new UserStakeInfo({ stakedAmount: new UintN64(0), lastStakeTime: new UintN64(0), totalRewardsEarned: new UintN64(0) })

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 1000
    contract.stakers(sender).value = new UserStakeInfo({ stakedAmount: new UintN64(1000), lastStakeTime: new UintN64(0), totalRewardsEarned: new UintN64(0) })

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 2000
    contract.stakers(sender).value = new UserStakeInfo({ stakedAmount: new UintN64(2000), lastStakeTime: new UintN64(0), totalRewardsEarned: new UintN64(0) })

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 1000
    contract.stakers(sender).value = new UserStakeInfo({ stakedAmount: new UintN64(1000), lastStakeTime: new UintN64(0), totalRewardsEarned: new UintN64(0) })

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.stakers(sender).value = new UserStakeInfo({ stakedAmount: new UintN64(10000), lastStakeTime: new UintN64(0), totalRewardsEarned: new UintN64(0) })

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.stakers(sender).value = new UserStakeInfo({ stakedAmount: new UintN64(10000), lastStakeTime: new UintN64(0), totalRewardsEarned: new UintN64(0) })

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
    contract.aprBasisPoints.value = 10000
    contract.distributionPeriodSeconds.value = 60 * 60 * 24
    contract.minimumStake.value = 1000
    contract.totalStaked.value = 10000
    contract.stakers(staker1).value = new UserStakeInfo({ stakedAmount: new UintN64(5000), lastStakeTime: new UintN64(0), totalRewardsEarned: new UintN64(0) })
    contract.stakers(staker2).value = new UserStakeInfo({ stakedAmount: new UintN64(5000), lastStakeTime: new UintN64(0), totalRewardsEarned: new UintN64(0) })

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
})