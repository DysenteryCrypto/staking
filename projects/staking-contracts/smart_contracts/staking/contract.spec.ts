import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it } from 'vitest'
import { ASAStakingContract } from './contract.algo'

describe('Staking contract', () => {
  const ctx = new TestExecutionContext()
  it('Logs the returned value when sayHello is called', () => {
    const contract = ctx.contract.create(ASAStakingContract)

    contract.initialize(1, ctx.defaultSender, 10000, 60 * 60 * 24, 1000000000000n)

    expect(contract.assetId.value).toBe(1)
  })
})
