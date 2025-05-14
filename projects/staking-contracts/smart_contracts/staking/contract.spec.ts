import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it, beforeEach } from 'vitest'
import { ASAStakingContract } from './contract.algo'
import { Asset } from '@algorandfoundation/algorand-typescript'

describe('Staking contract', () => {
  const ctx = new TestExecutionContext()
  let gContract: ASAStakingContract
  let gAsset: Asset

  beforeEach(() => {
    ctx.reset()

    gAsset = ctx.any.asset()
    gContract = ctx.contract.create(ASAStakingContract)
    gContract.initialize(gAsset.id, ctx.defaultSender, 10000, 60 * 60 * 24, 1000)
  })

  it('Initializes the contract', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()

    contract.initialize(asset.id, ctx.defaultSender, 10000, 60 * 60 * 24, 1000)

    expect(contract.assetId.value).toBe(asset.id)
    expect(contract.adminAddress.value).toBe(ctx.defaultSender)
    expect(contract.aprBasisPoints.value).toBe(10000)
    expect(contract.distributionPeriodSeconds.value).toBe(60 * 60 * 24)
    expect(contract.minimumStake.value).toBe(1000)
  })

  it('Cannot opt in to the ASA if not the creator', () => {
    const contract = ctx.contract.create(ASAStakingContract)
    const asset = ctx.any.asset()

    contract.initialize(asset.id, ctx.any.account(), 10000, 60 * 60 * 24, 1000)

    expect(() => contract.optInToAsset()).toThrow()
  })

  it('Opt in to the ASA', () => {
    gContract.optInToAsset()

    expect(ctx.txn.lastGroup.transactions.length).toEqual(1)
    expect(ctx.txn.lastGroup.transactions[0].sender).toEqual(ctx.defaultSender)
    expect(ctx.txn.lastGroup.transactions[0].type).toEqual(6) // AppCall

    const assetTransferTxn = ctx.txn.lastGroup.lastItxnGroup().getAssetTransferInnerTxn()
    expect(assetTransferTxn.assetAmount).toEqual(0)
    expect(assetTransferTxn.xferAsset).toEqual(gAsset)
  })

  it('Cannot opt in if already opted in', () => {
    expect(() => gContract.optInToAsset()).toThrow()
  })
  
})
