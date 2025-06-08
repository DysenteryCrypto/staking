import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AsaStakingContractFactory } from '../artifacts/staking/ASAStakingContractClient'

// Below is a showcase of various deployment options you can use in TypeScript Client
export async function deploy() {
  console.log('=== Deploying Staking ===')

  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  const factory = algorand.client.getTypedAppFactory(AsaStakingContractFactory, {
    defaultSender: deployer.addr,
  })

  const { appClient, result } = await factory.deploy({ onUpdate: 'append', onSchemaBreak: 'append' })

  // If app was just created fund the app account
  if (['create', 'replace'].includes(result.operationPerformed)) {
    await algorand.send.payment({
      amount: (1).algo(),
      sender: deployer.addr,
      receiver: appClient.appAddress,
    })
  }

  await appClient.send.initialize({
    args: {
      asset: BigInt(1001),
      adminAddress: deployer.addr.toString(),
      minimumStake: 1000_000_000, // 1,000
      weeklyRewards: 100_000_000_000_000, // 100,000,000
      rewardPeriod: 300, // 5 minutes
    },
  })

  /*
  const method = 'hello'
  const response = await appClient.send.hello({
    args: { name: 'world' },
  })
  console.log(
    `Called ${method} on ${appClient.appClient.appName} (${appClient.appClient.appId}) with name = world, received: ${response.return}`,
  )
  */
}
