import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { Address } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { AsaStakingContractFactory } from '../artifacts/staking/ASAStakingContractClient'

describe('Staking contract', () => {
  const localnet = algorandFixture()
  beforeAll(() => {
    Config.configure({
      debug: true,
      // traceAll: true,
    })
    registerDebugEventHandlers()
  })
  beforeEach(localnet.newScope)

  const deploy = async (account: Address) => {
    const factory: AsaStakingContractFactory = localnet.algorand.client.getTypedAppFactory(AsaStakingContractFactory, {
      defaultSender: account,
    })

    const { appClient } = await factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
    })
    return { client: appClient }
  }

  test('says hello', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount)

    const { assetId } = await localnet.algorand.send.assetCreate({
      sender: testAccount,
      assetName: 'Test Asset',
      unitName: 'TEST',
      decimals: 6,
      total: 1000000000000n,
    })

    const result = await client.send.initialize({
      args: {
        assetId: assetId,
        adminAddress: testAccount.addr.toString(),
        aprBasisPoints: 10000,
        distributionPeriodSeconds: 60 * 60 * 24,
        minimumStake: 1000000000000n,
      },
    })

    console.log(result)

    expect(await client.state.global.assetId()).toEqual(assetId)
  })

  /*
  test('simulate says hello with correct budget consumed', async () => {
    const { testAccount } = localnet.context
    const { client } = await deploy(testAccount)
    const result = await client
      .newGroup()
      .hello({ args: { name: 'World' } })
      .hello({ args: { name: 'Jane' } })
      .simulate()

    expect(result.returns[0]).toBe('Hello, World')
    expect(result.returns[1]).toBe('Hello, Jane')
    expect(result.simulateResponse.txnGroups[0].appBudgetConsumed).toBeLessThan(100)
  })
    */
})
