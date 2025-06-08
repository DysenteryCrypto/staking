import React from 'react'

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

interface AppGlobalStateProps {
  globalState: AppGlobalState | null
  loading?: boolean
}

const AppGlobalStateDisplay: React.FC<AppGlobalStateProps> = ({ globalState, loading = false }) => {
  // Format token amounts
  const formatToken = (amount: bigint, decimals: number = 6): string => {
    return (Number(amount) / Math.pow(10, decimals)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  }

  // Format timestamp
  const formatTimestamp = (timestamp: bigint): string => {
    if (timestamp === 0n) return 'N/A'
    const date = new Date(Number(timestamp) * 1000)
    return date.toLocaleString()
  }

  // Format period (assuming it's in seconds)
  const formatPeriod = (seconds: bigint): string => {
    const totalSeconds = Number(seconds)
    const days = Math.floor(totalSeconds / (24 * 60 * 60))
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60))
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60)

    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  if (loading) {
    return (
      <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
        <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
        <h3 className="text-xl text-green-500 uppercase mb-4">STAKING DATA</h3>
        <div className="text-green-500 crt-pulse">LOADING STAKING DATA...</div>
      </div>
    )
  }

  if (!globalState) {
    return (
      <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
        <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
        <h3 className="text-xl text-green-500 uppercase mb-4">STAKING GLOBAL STATE</h3>
        <div className="text-amber-500">NO STAKING DATA AVAILABLE</div>
      </div>
    )
  }

  return (
    <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
      <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
      <h3 className="text-xl text-green-500 uppercase mb-4">STAKING DATA</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-green-950/50 border border-green-500/30 rounded-sm p-3">
          <div className="text-sm text-green-500 uppercase mb-1">Total Staked</div>
          <div className="text-lg font-bold text-cyan-400">{formatToken(globalState.totalStaked)}</div>
        </div>

        <div className="bg-green-950/50 border border-green-500/30 rounded-sm p-3">
          <div className="text-sm text-green-500 uppercase mb-1">Weekly Rewards</div>
          <div className="text-lg font-bold text-amber-500">{formatToken(globalState.weeklyRewards)}</div>
        </div>

        <div className="bg-green-950/50 border border-green-500/30 rounded-sm p-3">
          <div className="text-sm text-green-500 uppercase mb-1">Minimum Stake</div>
          <div className="text-lg font-bold text-cyan-400">{formatToken(globalState.minimumStake)}</div>
        </div>

        <div className="bg-green-950/50 border border-green-500/30 rounded-sm p-3">
          <div className="text-sm text-green-500 uppercase mb-1">Reward Period</div>
          <div className="text-lg font-bold text-amber-500">{formatPeriod(globalState.rewardPeriod)}</div>
        </div>

        <div className="bg-green-950/50 border border-green-500/30 rounded-sm p-3">
          <div className="text-sm text-green-500 uppercase mb-1">Asset ID</div>
          <div className="text-lg font-bold text-cyan-400">{globalState.asset.toString()}</div>
        </div>

        <div className="bg-green-950/50 border border-green-500/30 rounded-sm p-3">
          <div className="text-sm text-green-500 uppercase mb-1">Last Reward Time</div>
          <div className="text-lg font-bold text-amber-500">{formatTimestamp(globalState.lastRewardTime)}</div>
        </div>
      </div>
    </div>
  )
}

export default AppGlobalStateDisplay
