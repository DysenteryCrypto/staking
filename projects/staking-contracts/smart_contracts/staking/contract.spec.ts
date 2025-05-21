import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it, beforeEach } from 'vitest'
import { ASAStakingContract } from './contract.algo'
import { Bytes } from '@algorandfoundation/algorand-typescript'

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

    const txn = ctx.any.txn.assetTransfer({
      assetReceiver: app.address,
      assetAmount: 1000000,
      assetSender: sender,
      xferAsset: asset,
    })

    ctx.txn.createScope([txn, ctx.any.txn.applicationCall({ sender, appId: app }) ], 1).execute(() => {
      contract.stake()
    })
  })
})
