import React, { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useSnackbar } from 'notistack'
import { AsaStakingContractClient } from '../contracts/ASAStakingContract'
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount'

type AppGlobalState = {
  rewardPool: bigint
  accumulatedRewardsPerShare: bigint
  adminAddress: string
  lastRewardTime: bigint
  asset: bigint
  minimumStake: bigint
  rewardPeriod: bigint
  totalStaked: bigint
  weeklyRewards: bigint
}

interface AdminPanelProps {
  contractClient: AsaStakingContractClient | null
  appGlobalState: AppGlobalState | null
  loading: boolean
  onStateUpdate: () => void
}

const AdminPanel: React.FC<AdminPanelProps> = ({ contractClient, appGlobalState, loading: parentLoading, onStateUpdate }) => {
  const { activeAddress, transactionSigner } = useWallet()
  const { enqueueSnackbar } = useSnackbar()

  // Local state for admin actions
  const [loading, setLoading] = useState(false)
  const [newAdminAddress, setNewAdminAddress] = useState('')
  const [emergencyWithdrawAmount, setEmergencyWithdrawAmount] = useState('')
  const [newWeeklyRewards, setNewWeeklyRewards] = useState('')
  const [newRewardPeriod, setNewRewardPeriod] = useState('')
  const [rewardPoolAmount, setRewardPoolAmount] = useState('')

  // Format token amounts
  const formatToken = (amount: bigint, decimals: number = 6): string => {
    return (Number(amount) / Math.pow(10, decimals)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  }

  // Format period (convert from seconds to readable format)
  const formatPeriod = (seconds: bigint): string => {
    const sec = Number(seconds)
    const days = Math.floor(sec / 86400)
    const hours = Math.floor((sec % 86400) / 3600)
    const minutes = Math.floor((sec % 3600) / 60)

    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m ${sec % 60}s`
  }

  // Check if current user is admin
  const isAdmin = activeAddress && appGlobalState && activeAddress === appGlobalState.adminAddress

  // Opt into asset
  const handleOptInToAsset = async () => {
    if (!contractClient || !transactionSigner || !activeAddress) return

    try {
      setLoading(true)
      await contractClient.send.optInToAsset({
        args: [],
        sender: activeAddress,
        staticFee: AlgoAmount.MicroAlgos(2000),
      })
      enqueueSnackbar('Successfully opted contract into asset!', { variant: 'success' })
      onStateUpdate()
    } catch (error) {
      enqueueSnackbar('Failed to opt contract into asset', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Update admin address
  const handleUpdateAdmin = async () => {
    if (!contractClient || !transactionSigner || !newAdminAddress || !activeAddress) return

    try {
      setLoading(true)
      await contractClient.send.updateAdmin({
        args: { newAdminAddress },
        sender: activeAddress,
        signer: transactionSigner,
      })
      enqueueSnackbar('Successfully updated admin address!', { variant: 'success' })
      setNewAdminAddress('')
      onStateUpdate()
    } catch (error) {
      enqueueSnackbar('Failed to update admin address', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Trigger reward distribution
  const handleTriggerRewardDistribution = async () => {
    if (!contractClient || !transactionSigner || !activeAddress) return

    try {
      setLoading(true)
      await contractClient.send.triggerRewardDistribution({
        args: [],
        sender: activeAddress,
      })
      enqueueSnackbar('Successfully triggered reward distribution!', { variant: 'success' })
      onStateUpdate()
    } catch (error) {
      enqueueSnackbar('Failed to trigger reward distribution', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Emergency withdraw rewards
  const handleEmergencyWithdrawRewards = async () => {
    if (!contractClient || !transactionSigner || !emergencyWithdrawAmount || !activeAddress) return

    try {
      setLoading(true)
      const amount = BigInt(parseFloat(emergencyWithdrawAmount) * 1e6)

      await contractClient.send.emergencyWithdrawRewards({
        args: { amount },
        sender: activeAddress,
        signer: transactionSigner,
      })
      enqueueSnackbar('Successfully withdrew rewards!', { variant: 'success' })
      setEmergencyWithdrawAmount('')
      onStateUpdate()
    } catch (error) {
      enqueueSnackbar('Failed to withdraw rewards', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Update weekly rewards
  const handleUpdateWeeklyRewards = async () => {
    if (!contractClient || !transactionSigner || !newWeeklyRewards || !activeAddress) return

    try {
      setLoading(true)
      const weeklyRewards = BigInt(parseFloat(newWeeklyRewards) * 1e6)

      await contractClient.send.updateWeeklyRewards({
        args: { newWeeklyRewards: weeklyRewards },
        sender: activeAddress,
        signer: transactionSigner,
      })
      enqueueSnackbar('Successfully updated weekly rewards!', { variant: 'success' })
      setNewWeeklyRewards('')
      onStateUpdate()
    } catch (error) {
      enqueueSnackbar('Failed to update weekly rewards', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Update reward period
  const handleUpdateRewardPeriod = async () => {
    if (!contractClient || !transactionSigner || !newRewardPeriod || !activeAddress) return

    try {
      setLoading(true)
      const rewardPeriod = BigInt(parseInt(newRewardPeriod) * 86400) // Convert days to seconds

      await contractClient.send.updateRewardPeriod({
        args: { newRewardPeriod: rewardPeriod },
        sender: activeAddress,
        signer: transactionSigner,
      })
      enqueueSnackbar('Successfully updated reward period!', { variant: 'success' })
      setNewRewardPeriod('')
      onStateUpdate()
    } catch (error) {
      enqueueSnackbar('Failed to update reward period', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Add rewards to pool (requires transferring tokens to contract first)
  const handleAddRewardsToPool = async () => {
    if (!contractClient || !transactionSigner || !rewardPoolAmount || !appGlobalState || !activeAddress) return

    try {
      setLoading(true)
      const amount = BigInt(parseFloat(rewardPoolAmount) * 1e6)

      const txn = await contractClient.algorand.createTransaction.assetTransfer({
        amount,
        sender: activeAddress,
        receiver: contractClient.appAddress,
        assetId: appGlobalState.asset,
      })

      await contractClient.newGroup().addTransaction(txn).addRewards().send()

      enqueueSnackbar('Rewards sent to reward pool!', { variant: 'success' })
      setRewardPoolAmount('')
    } catch (error) {
      enqueueSnackbar('Failed to add rewards to pool', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* Admin Panel Header */}
      <div className="bg-red-900/80 border-2 border-red-500 rounded-md p-4 relative">
        <div className="absolute inset-1 border border-red-500/30 rounded-sm pointer-events-none" />
        <h2 className="text-2xl font-bold text-red-500 uppercase">⚠️ ADMIN CONTROL PANEL ⚠️</h2>
        <p className="text-red-400 mt-2">You are logged in as the contract administrator.</p>
      </div>

      {/* Current Settings Display */}
      <div className="bg-amber-900/80 border-2 border-amber-500 rounded-md p-4 relative">
        <div className="absolute inset-1 border border-amber-500/30 rounded-sm pointer-events-none" />
        <h3 className="text-xl text-amber-500 uppercase mb-4">CURRENT CONTRACT SETTINGS</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-amber-400">
          <div>
            <span className="text-amber-500 uppercase">Reward Pool:</span>
            <br />
            <span className="font-mono">{formatToken(appGlobalState?.rewardPool || 0n)}</span>
          </div>
          <div>
            <span className="text-amber-500 uppercase">Weekly Rewards:</span>
            <br />
            <span className="font-mono">{formatToken(appGlobalState?.weeklyRewards || 0n)}</span>
          </div>
          <div>
            <span className="text-amber-500 uppercase">Reward Period:</span>
            <br />
            <span className="font-mono">{formatPeriod(appGlobalState?.rewardPeriod || 0n)}</span>
          </div>
          <div>
            <span className="text-amber-500 uppercase">Total Staked:</span>
            <br />
            <span className="font-mono">{formatToken(appGlobalState?.totalStaked || 0n)}</span>
          </div>
          <div>
            <span className="text-amber-500 uppercase">Minimum Stake:</span>
            <br />
            <span className="font-mono">{formatToken(appGlobalState?.minimumStake || 0n)}</span>
          </div>
          <div>
            <span className="text-amber-500 uppercase">Asset ID:</span>
            <br />
            <span className="font-mono">{appGlobalState?.asset?.toString() || 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* Admin Actions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contract Management */}
        <div className="bg-blue-900/80 border-2 border-blue-500 rounded-md p-4 relative">
          <div className="absolute inset-1 border border-blue-500/30 rounded-sm pointer-events-none" />
          <h3 className="text-xl text-blue-500 uppercase mb-4">CONTRACT MANAGEMENT</h3>
          <div className="space-y-4">
            <button
              className={`w-full bg-blue-500/10 border-2 border-blue-500 text-blue-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-blue-500/20 hover:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading || parentLoading ? 'crt-pulse' : ''}`}
              onClick={handleOptInToAsset}
              disabled={loading || parentLoading}
            >
              {loading ? 'PROCESSING...' : 'OPT CONTRACT INTO ASSET'}
            </button>

            <button
              className={`w-full bg-green-500/10 border-2 border-green-500 text-green-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-green-500/20 hover:border-green-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading || parentLoading ? 'crt-pulse' : ''}`}
              onClick={handleTriggerRewardDistribution}
              disabled={loading || parentLoading}
            >
              {loading ? 'PROCESSING...' : 'TRIGGER REWARD DISTRIBUTION'}
            </button>
          </div>
        </div>

        {/* Update Admin */}
        <div className="bg-purple-900/80 border-2 border-purple-500 rounded-md p-4 relative">
          <div className="absolute inset-1 border border-purple-500/30 rounded-sm pointer-events-none" />
          <h3 className="text-xl text-purple-500 uppercase mb-4">UPDATE ADMIN</h3>
          <div className="space-y-4">
            <input
              type="text"
              className="w-full bg-purple-950/80 border-2 border-purple-500 text-purple-500 p-2 font-mono rounded-sm focus:outline-none focus:border-purple-400 placeholder:text-purple-500/50"
              placeholder="New admin address"
              value={newAdminAddress}
              onChange={(e) => setNewAdminAddress(e.target.value)}
            />
            <button
              className={`w-full bg-purple-500/10 border-2 border-purple-500 text-purple-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-purple-500/20 hover:border-purple-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading || parentLoading ? 'crt-pulse' : ''}`}
              onClick={handleUpdateAdmin}
              disabled={loading || parentLoading || !newAdminAddress}
            >
              {loading ? 'UPDATING...' : 'UPDATE ADMIN'}
            </button>
          </div>
        </div>

        {/* Emergency Withdraw */}
        <div className="bg-red-900/80 border-2 border-red-500 rounded-md p-4 relative">
          <div className="absolute inset-1 border border-red-500/30 rounded-sm pointer-events-none" />
          <h3 className="text-xl text-red-500 uppercase mb-4">EMERGENCY WITHDRAW</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-red-500 uppercase">Amount to Withdraw</span>
                <span className="text-sm text-red-400 uppercase">Pool: {formatToken(appGlobalState?.rewardPool || 0n)}</span>
              </div>
              <div className="flex space-x-2">
                <input
                  type="number"
                  className="flex-1 bg-red-950/80 border-2 border-red-500 text-red-500 p-2 font-mono rounded-sm focus:outline-none focus:border-red-400 placeholder:text-red-500/50"
                  placeholder="Enter amount"
                  value={emergencyWithdrawAmount}
                  onChange={(e) => setEmergencyWithdrawAmount(e.target.value)}
                  step="0.000001"
                  min="0"
                />
                <button
                  className="bg-red-500/10 border-2 border-red-500 text-red-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-red-500/20 hover:border-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setEmergencyWithdrawAmount(formatToken(appGlobalState?.rewardPool || 0n))}
                  disabled={!appGlobalState?.rewardPool || appGlobalState.rewardPool === 0n}
                >
                  MAX
                </button>
              </div>
            </div>
            <button
              className={`w-full bg-red-500/10 border-2 border-red-500 text-red-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-red-500/20 hover:border-red-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading || parentLoading ? 'crt-pulse' : ''}`}
              onClick={handleEmergencyWithdrawRewards}
              disabled={loading || parentLoading || !emergencyWithdrawAmount}
            >
              {loading ? 'WITHDRAWING...' : 'EMERGENCY WITHDRAW'}
            </button>
          </div>
        </div>

        {/* Update Rewards Settings */}
        <div className="bg-yellow-900/80 border-2 border-yellow-500 rounded-md p-4 relative">
          <div className="absolute inset-1 border border-yellow-500/30 rounded-sm pointer-events-none" />
          <h3 className="text-xl text-yellow-500 uppercase mb-4">UPDATE REWARD SETTINGS</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-yellow-500 uppercase block mb-2">Weekly Rewards Amount</label>
              <input
                type="number"
                className="w-full bg-yellow-950/80 border-2 border-yellow-500 text-yellow-500 p-2 font-mono rounded-sm focus:outline-none focus:border-yellow-400 placeholder:text-yellow-500/50"
                placeholder="Enter weekly rewards"
                value={newWeeklyRewards}
                onChange={(e) => setNewWeeklyRewards(e.target.value)}
                step="0.000001"
                min="0"
              />
              <button
                className={`w-full mt-2 bg-yellow-500/10 border-2 border-yellow-500 text-yellow-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-yellow-500/20 hover:border-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading || parentLoading ? 'crt-pulse' : ''}`}
                onClick={handleUpdateWeeklyRewards}
                disabled={loading || parentLoading || !newWeeklyRewards}
              >
                {loading ? 'UPDATING...' : 'UPDATE WEEKLY REWARDS'}
              </button>
            </div>

            <div>
              <label className="text-sm text-yellow-500 uppercase block mb-2">Reward Period (Days)</label>
              <input
                type="number"
                className="w-full bg-yellow-950/80 border-2 border-yellow-500 text-yellow-500 p-2 font-mono rounded-sm focus:outline-none focus:border-yellow-400 placeholder:text-yellow-500/50"
                placeholder="Enter period in days"
                value={newRewardPeriod}
                onChange={(e) => setNewRewardPeriod(e.target.value)}
                min="1"
              />
              <button
                className={`w-full mt-2 bg-yellow-500/10 border-2 border-yellow-500 text-yellow-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-yellow-500/20 hover:border-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading || parentLoading ? 'crt-pulse' : ''}`}
                onClick={handleUpdateRewardPeriod}
                disabled={loading || parentLoading || !newRewardPeriod}
              >
                {loading ? 'UPDATING...' : 'UPDATE REWARD PERIOD'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Rewards to Pool (Placeholder) */}
      <div className="bg-cyan-900/80 border-2 border-cyan-500 rounded-md p-4 relative">
        <div className="absolute inset-1 border border-cyan-500/30 rounded-sm pointer-events-none" />
        <h3 className="text-xl text-cyan-500 uppercase mb-4">ADD REWARDS TO POOL</h3>
        <div className="space-y-4">
          <p className="text-cyan-400 text-sm">Note: This requires implementing a transaction group with asset transfer + contract call.</p>
          <div className="flex space-x-2">
            <input
              type="number"
              className="flex-1 bg-cyan-950/80 border-2 border-cyan-500 text-cyan-500 p-2 font-mono rounded-sm focus:outline-none focus:border-cyan-400 placeholder:text-cyan-500/50"
              placeholder="Amount to add to rewards pool"
              value={rewardPoolAmount}
              onChange={(e) => setRewardPoolAmount(e.target.value)}
              step="0.000001"
              min="0"
            />
            <button
              className={`bg-cyan-500/10 border-2 border-cyan-500 text-cyan-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-cyan-500/20 hover:border-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading || parentLoading ? 'crt-pulse' : ''}`}
              onClick={handleAddRewardsToPool}
              disabled={loading || parentLoading || !rewardPoolAmount}
            >
              {loading ? 'ADDING...' : 'ADD REWARDS (PLACEHOLDER)'}
            </button>
          </div>
        </div>
      </div>

      {/* Warning */}
      <div className="bg-red-500/10 border-2 border-red-500 rounded-md p-4">
        <h3 className="text-xl text-red-500 uppercase mb-4">⚠️ ADMIN WARNING</h3>
        <div className="text-red-400 space-y-2">
          <p>
            <strong>USE THESE FUNCTIONS WITH EXTREME CAUTION!</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>EMERGENCY WITHDRAW removes funds from the reward pool permanently</li>
            <li>UPDATING REWARD SETTINGS affects all current and future stakers</li>
            <li>CHANGING ADMIN ADDRESS transfers full control to the new address</li>
            <li>ALWAYS verify addresses and amounts before confirming transactions</li>
            <li>THESE ACTIONS CANNOT BE UNDONE</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default AdminPanel
