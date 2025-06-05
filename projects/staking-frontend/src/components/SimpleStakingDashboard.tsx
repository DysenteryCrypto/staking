import React, { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useSnackbar } from 'notistack'
import { getAlgodConfigFromViteEnvironment, getStakingConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import Account from './Account'
import { AsaStakingContractClient, AsaStakingContractFactory } from '../contracts/ASAStakingContract'

const SimpleStakingDashboard: React.FC = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { enqueueSnackbar } = useSnackbar()

  // State management
  const [loading, setLoading] = useState(false)
  const [appId, setAppId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [stakeAmount, setStakeAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [userBalance, setUserBalance] = useState<bigint>(0n)
  const [stakedAmount, setStakedAmount] = useState<bigint>(0n)
  const [pendingRewards, _setPendingRewards] = useState<bigint>(0n)
  const [currentAPY, _setCurrentAPY] = useState<bigint>(0n)
  const [contractClient, setContractClient] = useState<AsaStakingContractClient | null>(null)

  // Load user balance
  const loadUserBalance = async () => {
    if (!activeAddress || !assetId) return

    try {
      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algorand = AlgorandClient.fromConfig({ algodConfig })

      const accountInfo = await algorand.client.algod.accountInformation(activeAddress).do()
      const assetHolding = accountInfo.assets?.find((asset) => asset.assetId === BigInt(assetId))

      if (assetHolding) {
        setUserBalance(BigInt(assetHolding.amount))
      } else {
        setUserBalance(0n)
      }
    } catch (error) {
      enqueueSnackbar('Failed to load your asset balance', { variant: 'error' })
    }
  }

  // Format token amounts
  const formatToken = (amount: bigint, decimals: number = 6): string => {
    return (Number(amount) / Math.pow(10, decimals)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  }

  // Format APY
  const formatAPY = (apy: bigint): string => {
    return `${(Number(apy) / 100).toFixed(2)}%`
  }

  // Opt into asset
  const handleOptInToAsset = async () => {
    if (!activeAddress || !assetId || !transactionSigner) return

    try {
      setLoading(true)
      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algorand = AlgorandClient.fromConfig({ algodConfig })

      await algorand.send.assetTransfer({
        sender: activeAddress,
        receiver: activeAddress,
        amount: 0n,
        assetId: BigInt(assetId),
      })

      enqueueSnackbar('Successfully opted into asset!', { variant: 'success' })
      await loadUserBalance()
    } catch (error) {
      enqueueSnackbar('Failed to opt into asset', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Simple stake function (placeholder - you'll need to implement contract calls)
  const handleStake = async () => {
    if (!activeAddress || !stakeAmount || !assetId || !appId) return

    try {
      setLoading(true)

      const amountToStake = BigInt(parseFloat(stakeAmount) * 1e6)

      if (amountToStake > userBalance) {
        enqueueSnackbar('Insufficient balance', { variant: 'error' })
        return
      }

      // TODO: Implement actual contract interaction
      // This would involve creating a transaction group with:
      // 1. Asset transfer to contract
      // 2. Application call to stake method

      enqueueSnackbar('Stake transaction successful! (Placeholder)', { variant: 'success' })
      setStakeAmount('')

      // Update mock values
      setStakedAmount((prev) => prev + amountToStake)
      setUserBalance((prev) => prev - amountToStake)
    } catch (error) {
      enqueueSnackbar('Stake transaction failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Simple withdraw function (placeholder)
  const handleWithdraw = async () => {
    if (!activeAddress || !withdrawAmount || !appId) return

    try {
      setLoading(true)

      const amountToWithdraw = BigInt(parseFloat(withdrawAmount) * 1e6)

      if (amountToWithdraw > stakedAmount) {
        enqueueSnackbar('Insufficient staked amount', { variant: 'error' })
        return
      }

      // TODO: Implement actual contract interaction

      enqueueSnackbar('Withdraw transaction successful! (Placeholder)', { variant: 'success' })
      setWithdrawAmount('')

      // Update mock values
      setStakedAmount((prev) => prev - amountToWithdraw)
      setUserBalance((prev) => prev + amountToWithdraw)
    } catch (error) {
      enqueueSnackbar('Withdraw transaction failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const createContractClient = async () => {
    const config = getStakingConfigFromViteEnvironment()
    if (!config.appId) return

    const algodConfig = getAlgodConfigFromViteEnvironment()
    const algorand = AlgorandClient.fromConfig({ algodConfig })
    const factory = algorand.client.getTypedAppFactory(AsaStakingContractFactory, {
      defaultSender: activeAddress ?? undefined,
    })

    const contractClient = factory.getAppClientById({ appId: BigInt(config.appId) })

    setContractClient(contractClient)
  }

  // Load balance when inputs change
  useEffect(() => {
    loadUserBalance()
    createContractClient()
  }, [activeAddress, assetId])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex justify-between items-center">
          <h2 className="text-3xl font-bold text-gray-800">Staking Dashboard</h2>
          <Account />
        </div>
      </div>

      {/* Contract Configuration */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Connect to Staking Contract</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">
              <span className="label-text">App ID</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Enter staking contract App ID"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              <span className="label-text">Asset ID</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Enter ASA token ID"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* User Balance */}
      {assetId && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-gray-600">Your Token Balance</h3>
              <p className="text-2xl font-bold text-blue-600">{formatToken(userBalance)}</p>
            </div>
            {userBalance === 0n && (
              <button className={`btn btn-secondary ${loading ? 'loading' : ''}`} onClick={handleOptInToAsset} disabled={loading}>
                Opt Into Asset
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-600 mb-2">Your Staked</h3>
          <p className="text-3xl font-bold text-blue-600">{formatToken(stakedAmount)}</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-600 mb-2">Pending Rewards</h3>
          <p className="text-3xl font-bold text-green-600">{formatToken(pendingRewards)}</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-600 mb-2">Total Balance</h3>
          <p className="text-3xl font-bold text-purple-600">{formatToken(userBalance + stakedAmount)}</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-lg font-semibold text-gray-600 mb-2">Current APY</h3>
          <p className="text-3xl font-bold text-orange-600">{formatAPY(currentAPY)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stake */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Stake Tokens</h3>
          <div className="space-y-4">
            <div>
              <label className="label">
                <span className="label-text">Amount to Stake</span>
                <span className="label-text-alt">Balance: {formatToken(userBalance)}</span>
              </label>
              <div className="flex space-x-2">
                <input
                  type="number"
                  className="input input-bordered flex-1"
                  placeholder="Enter amount"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  step="0.000001"
                  min="0"
                />
                <button className="btn btn-outline" onClick={() => setStakeAmount(formatToken(userBalance))} disabled={userBalance === 0n}>
                  MAX
                </button>
              </div>
            </div>
            <button
              className={`btn btn-primary w-full ${loading ? 'loading' : ''}`}
              onClick={handleStake}
              disabled={loading || !stakeAmount || userBalance === 0n || !appId}
            >
              {loading ? 'Staking...' : 'Stake'}
            </button>
            <div className="text-sm text-yellow-600">
              Note: Contract integration is a placeholder. Implement actual contract calls for production use.
            </div>
          </div>
        </div>

        {/* Withdraw */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Withdraw Tokens</h3>
          <div className="space-y-4">
            <div>
              <label className="label">
                <span className="label-text">Amount to Withdraw</span>
                <span className="label-text-alt">Staked: {formatToken(stakedAmount)}</span>
              </label>
              <div className="flex space-x-2">
                <input
                  type="number"
                  className="input input-bordered flex-1"
                  placeholder="Enter amount"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  step="0.000001"
                  min="0"
                />
                <button
                  className="btn btn-outline"
                  onClick={() => setWithdrawAmount(formatToken(stakedAmount))}
                  disabled={stakedAmount === 0n}
                >
                  MAX
                </button>
              </div>
            </div>
            <button
              className={`btn btn-secondary w-full ${loading ? 'loading' : ''}`}
              onClick={handleWithdraw}
              disabled={loading || !withdrawAmount || stakedAmount === 0n || !appId}
            >
              {loading ? 'Withdrawing...' : 'Withdraw'}
            </button>
            <div className="text-sm text-yellow-600">
              Note: Contract integration is a placeholder. Implement actual contract calls for production use.
            </div>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 rounded-lg shadow-lg p-6 border-2 border-blue-200">
        <h3 className="text-xl font-semibold text-blue-800 mb-4">Integration Instructions</h3>
        <div className="text-blue-700 space-y-2">
          <p>
            <strong>This is a template implementation.</strong> To complete the integration:
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-4">
            <li>Import your generated ASA staking contract client</li>
            <li>Initialize the contract client with the App ID</li>
            <li>Implement proper transaction groups for staking (asset transfer + contract call)</li>
            <li>Add contract method calls for getUserStats, getPendingRewards, etc.</li>
            <li>Handle transaction signing and submission</li>
            <li>Add error handling and transaction confirmation</li>
          </ol>
          <p className="mt-4">
            Refer to the <code>ASAStakingContract.ts</code> file for available methods and the README for detailed integration steps.
          </p>
        </div>
      </div>

      {/* Refresh Button */}
      <div className="text-center">
        <button className={`btn btn-outline ${loading ? 'loading' : ''}`} onClick={loadUserBalance} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh Balance'}
        </button>
      </div>
    </div>
  )
}

export default SimpleStakingDashboard
