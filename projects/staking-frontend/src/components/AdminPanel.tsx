import React, { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useSnackbar } from 'notistack'
import { AsaStakingContractClient } from '../contracts/ASAStakingContract'

interface AdminPanelProps {
  stakingClient: AsaStakingContractClient | null
  onRefresh?: () => void
}

const AdminPanel: React.FC<AdminPanelProps> = ({ stakingClient, onRefresh }) => {
  const { activeAddress } = useWallet()
  const { enqueueSnackbar } = useSnackbar()

  const [loading, setLoading] = useState(false)
  const [rewardAmount, setRewardAmount] = useState('')
  const [newWeeklyRewards, setNewWeeklyRewards] = useState('')
  const [newRewardPeriod, setNewRewardPeriod] = useState('')
  const [newAdminAddress, setNewAdminAddress] = useState('')
  const [emergencyWithdrawAmount, setEmergencyWithdrawAmount] = useState('')

  const handleAddRewards = async () => {
    if (!stakingClient || !rewardAmount) return

    try {
      setLoading(true)

      const result = await stakingClient.send.addRewards({
        args: [],
      })

      enqueueSnackbar('Rewards added successfully!', { variant: 'success' })
      setRewardAmount('')
      if (onRefresh) onRefresh()
    } catch (error) {
      console.error('Add rewards failed:', error)
      enqueueSnackbar('Failed to add rewards', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleTriggerRewardDistribution = async () => {
    if (!stakingClient) return

    try {
      setLoading(true)

      const result = await stakingClient.send.triggerRewardDistribution({
        args: [],
      })

      enqueueSnackbar('Reward distribution triggered!', { variant: 'success' })
      if (onRefresh) onRefresh()
    } catch (error) {
      console.error('Trigger reward distribution failed:', error)
      enqueueSnackbar('Failed to trigger reward distribution', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateWeeklyRewards = async () => {
    if (!stakingClient || !newWeeklyRewards) return

    try {
      setLoading(true)

      const amount = BigInt(parseFloat(newWeeklyRewards) * 1e6)

      const result = await stakingClient.send.updateWeeklyRewards({
        args: { newWeeklyRewards: amount },
      })

      enqueueSnackbar('Weekly rewards updated successfully!', { variant: 'success' })
      setNewWeeklyRewards('')
      if (onRefresh) onRefresh()
    } catch (error) {
      console.error('Update weekly rewards failed:', error)
      enqueueSnackbar('Failed to update weekly rewards', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateRewardPeriod = async () => {
    if (!stakingClient || !newRewardPeriod) return

    try {
      setLoading(true)

      const period = BigInt(parseInt(newRewardPeriod))

      const result = await stakingClient.send.updateRewardPeriod({
        args: { newRewardPeriod: period },
      })

      enqueueSnackbar('Reward period updated successfully!', { variant: 'success' })
      setNewRewardPeriod('')
      if (onRefresh) onRefresh()
    } catch (error) {
      console.error('Update reward period failed:', error)
      enqueueSnackbar('Failed to update reward period', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateAdmin = async () => {
    if (!stakingClient || !newAdminAddress) return

    try {
      setLoading(true)

      const result = await stakingClient.send.updateAdmin({
        args: { newAdminAddress },
      })

      enqueueSnackbar('Admin address updated successfully!', { variant: 'success' })
      setNewAdminAddress('')
      if (onRefresh) onRefresh()
    } catch (error) {
      console.error('Update admin failed:', error)
      enqueueSnackbar('Failed to update admin address', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleEmergencyWithdraw = async () => {
    if (!stakingClient || !emergencyWithdrawAmount) return

    try {
      setLoading(true)

      const amount = BigInt(parseFloat(emergencyWithdrawAmount) * 1e6)

      const result = await stakingClient.send.emergencyWithdrawRewards({
        args: { amount },
      })

      enqueueSnackbar('Emergency withdrawal successful!', { variant: 'success' })
      setEmergencyWithdrawAmount('')
      if (onRefresh) onRefresh()
    } catch (error) {
      console.error('Emergency withdraw failed:', error)
      enqueueSnackbar('Failed to emergency withdraw', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  if (!stakingClient) {
    return null
  }

  return (
    <div className="bg-red-50 rounded-lg shadow-lg p-6 border-2 border-red-200">
      <div className="flex items-center mb-4">
        <div className="bg-red-100 p-2 rounded-full mr-3">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-red-800">Admin Panel</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reward Management */}
        <div className="space-y-4">
          <h4 className="text-lg font-medium text-gray-800">Reward Management</h4>

          {/* Add Rewards */}
          <div className="space-y-2">
            <label className="label">
              <span className="label-text">Add Rewards (requires ASA transfer)</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="Reward amount"
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
              step="0.000001"
              min="0"
            />
            <button
              className={`btn btn-primary w-full ${loading ? 'loading' : ''}`}
              onClick={handleAddRewards}
              disabled={loading || !rewardAmount}
            >
              Add Rewards
            </button>
          </div>

          {/* Trigger Distribution */}
          <button
            className={`btn btn-secondary w-full ${loading ? 'loading' : ''}`}
            onClick={handleTriggerRewardDistribution}
            disabled={loading}
          >
            Trigger Reward Distribution
          </button>

          {/* Update Weekly Rewards */}
          <div className="space-y-2">
            <label className="label">
              <span className="label-text">Update Weekly Rewards</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="New weekly rewards amount"
              value={newWeeklyRewards}
              onChange={(e) => setNewWeeklyRewards(e.target.value)}
              step="0.000001"
              min="0"
            />
            <button
              className={`btn btn-primary w-full ${loading ? 'loading' : ''}`}
              onClick={handleUpdateWeeklyRewards}
              disabled={loading || !newWeeklyRewards}
            >
              Update Weekly Rewards
            </button>
          </div>

          {/* Update Reward Period */}
          <div className="space-y-2">
            <label className="label">
              <span className="label-text">Update Reward Period (seconds)</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="New reward period in seconds"
              value={newRewardPeriod}
              onChange={(e) => setNewRewardPeriod(e.target.value)}
              min="1"
            />
            <button
              className={`btn btn-primary w-full ${loading ? 'loading' : ''}`}
              onClick={handleUpdateRewardPeriod}
              disabled={loading || !newRewardPeriod}
            >
              Update Reward Period
            </button>
          </div>
        </div>

        {/* Administrative Functions */}
        <div className="space-y-4">
          <h4 className="text-lg font-medium text-gray-800">Administrative Functions</h4>

          {/* Update Admin */}
          <div className="space-y-2">
            <label className="label">
              <span className="label-text">Transfer Admin Rights</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="New admin address"
              value={newAdminAddress}
              onChange={(e) => setNewAdminAddress(e.target.value)}
            />
            <button
              className={`btn btn-warning w-full ${loading ? 'loading' : ''}`}
              onClick={handleUpdateAdmin}
              disabled={loading || !newAdminAddress}
            >
              Transfer Admin Rights
            </button>
          </div>

          {/* Emergency Withdraw */}
          <div className="space-y-2">
            <label className="label">
              <span className="label-text text-red-600">Emergency Withdraw Rewards</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full border-red-300"
              placeholder="Amount to withdraw"
              value={emergencyWithdrawAmount}
              onChange={(e) => setEmergencyWithdrawAmount(e.target.value)}
              step="0.000001"
              min="0"
            />
            <button
              className={`btn btn-error w-full ${loading ? 'loading' : ''}`}
              onClick={handleEmergencyWithdraw}
              disabled={loading || !emergencyWithdrawAmount}
            >
              Emergency Withdraw
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-yellow-50 rounded border border-yellow-200">
        <div className="flex items-start">
          <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <div className="text-sm text-yellow-800">
            <strong>Warning:</strong> Admin functions are powerful and irreversible. Please exercise caution when using these features.
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminPanel
