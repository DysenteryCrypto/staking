import React, { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useSnackbar } from 'notistack'
import { AsaStakingContractClient } from '../contracts/ASAStakingContract'
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import Account from './Account'
import AdminPanel from './AdminPanel'

interface StakingStats {
  stakedAmount: bigint
  pendingRewards: bigint
  totalRewardsEarned: bigint
  currentAPY: bigint
  firstStakeTime: bigint
  lastStakeTime: bigint
}

interface ContractStats {
  totalStaked: bigint
  rewardPool: bigint
  minimumStake: bigint
  weeklyRewards: bigint
  rewardPeriod: bigint
}

const StakingDashboard: React.FC = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { enqueueSnackbar } = useSnackbar()

  // State management
  const [stakingClient, setStakingClient] = useState<AsaStakingContractClient | null>(null)
  const [loading, setLoading] = useState(false)
  const [stakingStats, setStakingStats] = useState<StakingStats | null>(null)
  const [contractStats, setContractStats] = useState<ContractStats | null>(null)
  const [stakeAmount, setStakeAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [appId, setAppId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [userBalance, setUserBalance] = useState<bigint>(0n)

  // Initialize client
  useEffect(() => {
    if (activeAddress && appId) {
      initializeClient()
    }
  }, [activeAddress, appId])

  // Load data periodically
  useEffect(() => {
    if (stakingClient && activeAddress) {
      loadStakingData()
      loadUserBalance()
      const interval = setInterval(() => {
        loadStakingData()
        loadUserBalance()
      }, 30000) // Update every 30 seconds
      return () => clearInterval(interval)
    }
  }, [stakingClient, activeAddress, assetId])

  const initializeClient = async () => {
    try {
      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algorand = AlgorandClient.fromConfig({
        algodConfig,
      })

      const client = new AsaStakingContractClient({
        resolveBy: 'id',
        id: BigInt(appId),
        sender: activeAddress,
        signer: transactionSigner,
        algorand,
      })

      setStakingClient(client)
    } catch (error) {
      console.error('Failed to initialize client:', error)
      enqueueSnackbar('Failed to initialize staking client', { variant: 'error' })
    }
  }

  const loadUserBalance = async () => {
    if (!activeAddress || !assetId) return

    try {
      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algorand = AlgorandClient.fromConfig({
        algodConfig,
      })

      const accountInfo = await algorand.client.algod.accountInformation(activeAddress).do()
      const assetHolding = accountInfo.assets?.find((asset: any) => asset['asset-id'] === parseInt(assetId))

      if (assetHolding) {
        setUserBalance(BigInt(assetHolding.amount))
      } else {
        setUserBalance(0n)
      }
    } catch (error) {
      console.error('Failed to load user balance:', error)
    }
  }

  const loadStakingData = async () => {
    if (!stakingClient || !activeAddress) return

    try {
      setLoading(true)

      // Load user stats
      const userStats = await stakingClient.getUserStats({
        args: { userAddress: activeAddress },
      })

      // Load pending rewards
      const pendingRewards = await stakingClient.getPendingRewards({
        args: { userAddress: activeAddress },
      })

      // Load current APY
      const currentAPY = await stakingClient.getCurrentApy()

      // Load contract stats
      const contractStatsResult = await stakingClient.getContractStats()

      // Parse user stats (assuming format: [stakedAmount, firstStakeTime, lastStakeTime, totalRewardsEarned, rewardDebt])
      if (userStats && userStats.length >= 5) {
        setStakingStats({
          stakedAmount: userStats[0],
          firstStakeTime: userStats[1],
          lastStakeTime: userStats[2],
          totalRewardsEarned: userStats[3],
          pendingRewards: pendingRewards || 0n,
          currentAPY: currentAPY || 0n,
        })
      }

      // Parse contract stats (assuming format: [totalStaked, rewardPool, minimumStake, weeklyRewards, rewardPeriod])
      if (contractStatsResult && contractStatsResult.length >= 5) {
        setContractStats({
          totalStaked: contractStatsResult[0],
          rewardPool: contractStatsResult[1],
          minimumStake: contractStatsResult[2],
          weeklyRewards: contractStatsResult[3],
          rewardPeriod: contractStatsResult[4],
        })
      }
    } catch (error) {
      console.error('Failed to load staking data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleStake = async () => {
    if (!stakingClient || !activeAddress || !stakeAmount || !assetId) return

    try {
      setLoading(true)

      const amountToStake = BigInt(parseFloat(stakeAmount) * 1e6) // Assuming 6 decimals

      // Check if user has enough balance
      if (amountToStake > userBalance) {
        enqueueSnackbar('Insufficient balance', { variant: 'error' })
        return
      }

      // Check minimum stake requirement
      if (contractStats && amountToStake < contractStats.minimumStake) {
        enqueueSnackbar(`Minimum stake is ${formatToken(contractStats.minimumStake)}`, { variant: 'error' })
        return
      }

      // Create stake transaction
      const result = await stakingClient.send.stake({
        args: [],
      })

      enqueueSnackbar('Stake transaction successful!', { variant: 'success' })
      setStakeAmount('')
      await loadStakingData()
      await loadUserBalance()
    } catch (error) {
      console.error('Stake failed:', error)
      enqueueSnackbar('Stake transaction failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleWithdraw = async () => {
    if (!stakingClient || !activeAddress || !withdrawAmount) return

    try {
      setLoading(true)

      const amountToWithdraw = BigInt(parseFloat(withdrawAmount) * 1e6) // Assuming 6 decimals

      // Check if user has enough staked
      if (stakingStats && amountToWithdraw > stakingStats.stakedAmount) {
        enqueueSnackbar('Insufficient staked amount', { variant: 'error' })
        return
      }

      const result = await stakingClient.send.withdraw({
        args: { amount: amountToWithdraw },
      })

      enqueueSnackbar('Withdraw transaction successful!', { variant: 'success' })
      setWithdrawAmount('')
      await loadStakingData()
      await loadUserBalance()
    } catch (error) {
      console.error('Withdraw failed:', error)
      enqueueSnackbar('Withdraw transaction failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleOptInToAsset = async () => {
    if (!activeAddress || !assetId || !transactionSigner) return

    try {
      setLoading(true)

      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algorand = AlgorandClient.fromConfig({
        algodConfig,
      })

      // Create opt-in transaction
      const result = await algorand.send.assetTransfer({
        sender: activeAddress,
        receiver: activeAddress,
        amount: 0n,
        assetId: BigInt(assetId),
      })

      enqueueSnackbar('Successfully opted into asset!', { variant: 'success' })
      await loadUserBalance()
    } catch (error) {
      console.error('Opt-in failed:', error)
      enqueueSnackbar('Failed to opt into asset', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const formatToken = (amount: bigint, decimals: number = 6): string => {
    return (Number(amount) / Math.pow(10, decimals)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  }

  const formatAPY = (apy: bigint): string => {
    return `${(Number(apy) / 100).toFixed(2)}%`
  }

  const formatDate = (timestamp: bigint): string => {
    if (timestamp === 0n) return 'Never'
    return new Date(Number(timestamp) * 1000).toLocaleDateString()
  }

  const formatDuration = (seconds: bigint): string => {
    const days = Number(seconds) / (24 * 60 * 60)
    if (days >= 1) {
      return `${days.toFixed(1)} days`
    }
    const hours = Number(seconds) / (60 * 60)
    if (hours >= 1) {
      return `${hours.toFixed(1)} hours`
    }
    const minutes = Number(seconds) / 60
    return `${minutes.toFixed(1)} minutes`
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex justify-between items-center">
          <h2 className="text-3xl font-bold text-gray-800">Staking Dashboard</h2>
          <div className="flex items-center space-x-4">
            <Account />
            {stakingClient && (
              <button className="btn btn-sm btn-outline" onClick={() => setShowAdminPanel(!showAdminPanel)}>
                {showAdminPanel ? 'Hide Admin' : 'Show Admin'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Contract Configuration */}
      {!stakingClient && (
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
          {appId && assetId && (
            <div className="mt-4 text-center">
              <button className="btn btn-primary" onClick={initializeClient}>
                Connect to Contract
              </button>
            </div>
          )}
        </div>
      )}

      {stakingClient && (
        <>
          {/* User Balance */}
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

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-600 mb-2">Your Staked</h3>
              <p className="text-3xl font-bold text-blue-600">{stakingStats ? formatToken(stakingStats.stakedAmount) : '0.00'}</p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-600 mb-2">Pending Rewards</h3>
              <p className="text-3xl font-bold text-green-600">{stakingStats ? formatToken(stakingStats.pendingRewards) : '0.00'}</p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-600 mb-2">Total Earned</h3>
              <p className="text-3xl font-bold text-purple-600">{stakingStats ? formatToken(stakingStats.totalRewardsEarned) : '0.00'}</p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-600 mb-2">Current APY</h3>
              <p className="text-3xl font-bold text-orange-600">{stakingStats ? formatAPY(stakingStats.currentAPY) : '0.00%'}</p>
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
                      max={formatToken(userBalance)}
                    />
                    <button
                      className="btn btn-outline"
                      onClick={() => setStakeAmount(formatToken(userBalance))}
                      disabled={userBalance === 0n}
                    >
                      MAX
                    </button>
                  </div>
                  {contractStats && (
                    <div className="text-sm text-gray-500 mt-1">Minimum stake: {formatToken(contractStats.minimumStake)}</div>
                  )}
                </div>
                <button
                  className={`btn btn-primary w-full ${loading ? 'loading' : ''}`}
                  onClick={handleStake}
                  disabled={loading || !stakeAmount || userBalance === 0n}
                >
                  {loading ? 'Staking...' : 'Stake'}
                </button>
              </div>
            </div>

            {/* Withdraw */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-xl font-semibold mb-4">Withdraw Tokens</h3>
              <div className="space-y-4">
                <div>
                  <label className="label">
                    <span className="label-text">Amount to Withdraw</span>
                    <span className="label-text-alt">Staked: {stakingStats ? formatToken(stakingStats.stakedAmount) : '0.00'}</span>
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
                      max={stakingStats ? formatToken(stakingStats.stakedAmount) : '0'}
                    />
                    <button
                      className="btn btn-outline"
                      onClick={() => setWithdrawAmount(stakingStats ? formatToken(stakingStats.stakedAmount) : '0')}
                      disabled={!stakingStats?.stakedAmount || stakingStats.stakedAmount === 0n}
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <button
                  className={`btn btn-secondary w-full ${loading ? 'loading' : ''}`}
                  onClick={handleWithdraw}
                  disabled={loading || !withdrawAmount || !stakingStats?.stakedAmount}
                >
                  {loading ? 'Withdrawing...' : 'Withdraw'}
                </button>
              </div>
            </div>
          </div>

          {/* Detailed Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* User Details */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-xl font-semibold mb-4">Your Staking Details</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">First Stake:</span>
                  <span className="font-medium">{stakingStats ? formatDate(stakingStats.firstStakeTime) : 'Never'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Last Stake:</span>
                  <span className="font-medium">{stakingStats ? formatDate(stakingStats.lastStakeTime) : 'Never'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Staked Amount:</span>
                  <span className="font-medium">{stakingStats ? formatToken(stakingStats.stakedAmount) : '0.00'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Rewards:</span>
                  <span className="font-medium text-green-600">{stakingStats ? formatToken(stakingStats.totalRewardsEarned) : '0.00'}</span>
                </div>
              </div>
            </div>

            {/* Contract Stats */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-xl font-semibold mb-4">Contract Statistics</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Staked:</span>
                  <span className="font-medium">{contractStats ? formatToken(contractStats.totalStaked) : '0.00'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Reward Pool:</span>
                  <span className="font-medium">{contractStats ? formatToken(contractStats.rewardPool) : '0.00'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Minimum Stake:</span>
                  <span className="font-medium">{contractStats ? formatToken(contractStats.minimumStake) : '0.00'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Weekly Rewards:</span>
                  <span className="font-medium">{contractStats ? formatToken(contractStats.weeklyRewards) : '0.00'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Reward Period:</span>
                  <span className="font-medium">{contractStats ? formatDuration(contractStats.rewardPeriod) : '0 days'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Admin Panel */}
          {showAdminPanel && <AdminPanel stakingClient={stakingClient} onRefresh={loadStakingData} />}

          {/* Refresh Button */}
          <div className="text-center">
            <button className={`btn btn-outline ${loading ? 'loading' : ''}`} onClick={loadStakingData} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh Data'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default StakingDashboard
