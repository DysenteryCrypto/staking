import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it } from 'vitest'
import { ASAStakingContract } from './contract.algo'

describe('Staking contract', () => {
  const ctx = new TestExecutionContext()
  it('Initializes the contract', () => {
    const contract = ctx.contract.create(ASAStakingContract)

    contract.initialize(1, ctx.defaultSender, 10000, 60 * 60 * 24, 1000)

    expect(contract.assetId.value).toBe(1)
    expect(contract.adminAddress.value).toBe(ctx.defaultSender)
    expect(contract.aprBasisPoints.value).toBe(10000)
    expect(contract.distributionPeriodSeconds.value).toBe(60 * 60 * 24)
    expect(contract.minimumStake.value).toBe(1000)
  })
})
