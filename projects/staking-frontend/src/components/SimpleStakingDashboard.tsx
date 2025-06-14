import React, { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useSnackbar } from 'notistack'
import {
  getAlgodConfigFromViteEnvironment,
  getIndexerConfigFromViteEnvironment,
  getStakingConfigFromViteEnvironment,
} from '../utils/network/getAlgoClientConfigs'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import Account from './Account'
import AppGlobalStateDisplay from './AppGlobalState'
import AdminPanel from './AdminPanel'
import { AsaStakingContractClient, AsaStakingContractFactory } from '../contracts/ASAStakingContract'
import { ApplicationResponse } from 'algosdk/dist/types/client/v2/indexer/models/types'
import algosdk, { Address } from 'algosdk'

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

const SimpleStakingDashboard: React.FC = () => {
  const { activeAddress, transactionSigner } = useWallet()
  const { enqueueSnackbar } = useSnackbar()
  const config = getStakingConfigFromViteEnvironment()

  // State management
  const [loading, setLoading] = useState(false)
  const [stakeAmount, setStakeAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [userBalance, setUserBalance] = useState<bigint>(0n)
  const [stakedAmount, setStakedAmount] = useState<bigint>(0n)
  const [pendingRewards, _setPendingRewards] = useState<bigint>(0n)
  const [currentAPY, _setCurrentAPY] = useState<bigint>(0n)
  const [contractClient, setContractClient] = useState<AsaStakingContractClient | null>(null)
  const [appGlobalState, setAppGlobalState] = useState<AppGlobalState | null>(null)

  // Load user balance
  const loadUserBalance = async () => {
    if (!activeAddress) return

    try {
      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algorand = AlgorandClient.fromConfig({ algodConfig })

      const accountInfo = await algorand.client.algod.accountInformation(activeAddress).do()
      const assetHolding = accountInfo.assets?.find((asset) => asset.assetId === BigInt(config.asaId))

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
    if (!activeAddress || !transactionSigner) return

    try {
      setLoading(true)
      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algorand = AlgorandClient.fromConfig({ algodConfig })

      await algorand.send.assetTransfer({
        sender: activeAddress,
        receiver: activeAddress,
        amount: 0n,
        assetId: BigInt(config.asaId),
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
    if (!activeAddress || !stakeAmount || !config.appId || !config.asaId || !contractClient || !appGlobalState) return

    try {
      setLoading(true)

      const amountToStake = BigInt(parseFloat(stakeAmount) * 1e6)

      if (amountToStake > userBalance) {
        enqueueSnackbar('Insufficient balance', { variant: 'error' })
        return
      }

      const txn = await contractClient.algorand.createTransaction.assetTransfer({
        amount: amountToStake,
        sender: activeAddress,
        receiver: contractClient.appAddress,
        assetId: appGlobalState.asset,
      })

      await contractClient.newGroup().addTransaction(txn).stake().send()

      enqueueSnackbar('Staking successful!', { variant: 'success' })
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
    if (!activeAddress || !withdrawAmount || !config.appId || !contractClient || !appGlobalState) return

    try {
      setLoading(true)

      const amountToWithdraw = BigInt(parseFloat(withdrawAmount) * 1e6)

      if (amountToWithdraw > stakedAmount) {
        enqueueSnackbar('Insufficient staked amount', { variant: 'error' })
        return
      }

      await contractClient.send.withdraw({
        args: [amountToWithdraw],
      })

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
    const indexerConfig = getIndexerConfigFromViteEnvironment()
    const algorand = AlgorandClient.fromConfig({ algodConfig, indexerConfig })
    algorand.setDefaultSigner(transactionSigner)
    const factory = algorand.client.getTypedAppFactory(AsaStakingContractFactory, {
      defaultSender: activeAddress ?? undefined,
    })

    const contractClient = factory.getAppClientById({ appId: BigInt(config.appId) })

    setContractClient(contractClient)
  }

  const loadContractStats = async () => {
    if (!contractClient) return

    const appInfo = (await contractClient.algorand.client.indexer.lookupApplications(contractClient.appId).do()) as ApplicationResponse

    const globalState = appInfo.application?.params?.globalState
    if (globalState) {
      const state: AppGlobalState = {
        rewardPool: 0n,
        accumulatedRewardsPerShare: 0n,
        adminAddress: '',
        lastRewardTime: 0n,
        asset: 0n,
        minimumStake: 0n,
        rewardPeriod: 0n,
        totalStaked: 0n,
        weeklyRewards: 0n,
      }

      globalState.forEach((entry) => {
        if (entry.key) {
          const keyString = new TextDecoder().decode(new Uint8Array(entry.key))

          if (keyString === 'adminAddress') {
            const addr = new Address(entry.value?.bytes)
            state.adminAddress = addr.toString()
          } else {
            state[keyString as Exclude<keyof AppGlobalState, 'adminAddress'>] = entry.value?.uint ?? 0n
          }
        }
      })

      setAppGlobalState(state)

      // Calculate APY
      if (state.totalStaked > 0n) {
        const weeklyRewards = state.weeklyRewards
        const totalStaked = state.totalStaked
        const apy = (weeklyRewards * 52n * 100n) / totalStaked
        _setCurrentAPY(apy)
      } else {
        _setCurrentAPY(0n)
      }
    }
  }

  async function loadUserStake() {
    if (!contractClient || !activeAddress) return

    const address = algosdk.Address.fromString(activeAddress)
    const addressBytes = address.publicKey
    const boxName = Buffer.concat([Buffer.from('stakers'), Buffer.from(addressBytes)])

    try {
      const userStake = await contractClient.algorand.client.indexer.lookupApplicationBoxByIDandName(contractClient.appId, boxName).do()

      if (userStake) {
        const rawValue = userStake.value
        const valueBuffer = Buffer.from(rawValue)

        const stakeInfo = {
          stakedAmount: BigInt(valueBuffer.readBigUInt64BE(0)),
          firstStakeTime: BigInt(valueBuffer.readBigUInt64BE(8)),
          lastStakeTime: BigInt(valueBuffer.readBigUInt64BE(16)),
          totalRewardsEarned: BigInt(valueBuffer.readBigUInt64BE(24)),
          rewardDebt: BigInt(valueBuffer.readBigUInt64BE(32)),
        }

        // Update state with the stake info
        setStakedAmount(stakeInfo.stakedAmount)
      }
    } catch (error) {
      // Box not found is an expected case for new users
      setStakedAmount(0n)
    }
  }

  // Load balance when inputs change
  useEffect(() => {
    loadUserBalance()
    createContractClient()
  }, [activeAddress, config.asaId])

  useEffect(() => {
    if (contractClient) {
      loadContractStats()
    }
  }, [contractClient])

  useEffect(() => {
    if (contractClient && activeAddress) {
      loadUserStake()
    }
  }, [contractClient, activeAddress])

  return (
    <div className="min-h-screen bg-black font-mono relative overflow-x-hidden">
      {/* Custom CSS for animations and effects */}
      <style>{`
        @keyframes flicker {
          0% { opacity: 1; }
          100% { opacity: 0.96; }
        }
        @keyframes pulse-fade {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }
        .crt-flicker { animation: flicker 0.15s infinite linear alternate; }
        .crt-pulse { animation: pulse-fade 1s infinite; }
        .crt-scanlines {
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0, 255, 0, 0.03) 2px,
            rgba(0, 255, 0, 0.03) 4px
          );
        }
      `}</style>

      <div className="bg-gray-800 border-[20px] border-gray-700 rounded-2xl shadow-lg relative m-5 p-5 min-h-[calc(100vh-2.5rem)]">
        {/* Scanlines overlay */}
        <div className="absolute inset-0 crt-scanlines pointer-events-none z-10" />

        {/* Screen flicker overlay */}
        <div className="absolute inset-0 bg-green-500/[0.02] crt-flicker pointer-events-none z-10" />

        <div className="space-y-6 relative z-20">
          {/* Header */}
          <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
            <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-bold text-green-500 uppercase">STAKING TERMINAL v2.0</h2>
              <div className="flex items-center gap-4">
                <Account />
              </div>
            </div>
          </div>

          {/* User Balance */}
          {config.asaId && (
            <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
              <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg text-white uppercase">YOUR $DOD BALANCE</h3>
                  <p className="text-2xl font-bold text-cyan-400">{formatToken(userBalance)}</p>
                </div>
                {userBalance === 0n && (
                  <button
                    className={`bg-green-500/10 border-2 border-green-500 text-green-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-green-500/20 hover:border-green-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading ? 'crt-pulse' : ''}`}
                    onClick={handleOptInToAsset}
                    disabled={loading}
                  >
                    {loading ? 'PROCESSING...' : 'OPT INTO ASSET'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
              <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
              <h3 className="text-lg text-white uppercase mb-2">YOUR STAKED $DOD</h3>
              <p className="text-2xl font-bold text-cyan-400">{formatToken(stakedAmount)}</p>
            </div>

            <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
              <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
              <h3 className="text-lg text-white uppercase mb-2">PENDING REWARDS</h3>
              <p className="text-2xl font-bold text-green-500">{formatToken(pendingRewards)}</p>
            </div>

            <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
              <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
              <h3 className="text-lg text-white uppercase mb-2">TOTAL BALANCE</h3>
              <p className="text-2xl font-bold text-amber-500">{formatToken(userBalance + stakedAmount)}</p>
            </div>

            <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
              <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
              <h3 className="text-lg text-white uppercase mb-2">CURRENT APY</h3>
              <p className="text-2xl font-bold text-amber-500">{formatAPY(currentAPY)}</p>
            </div>
          </div>

          {/* Global State Display */}
          <AppGlobalStateDisplay globalState={appGlobalState} loading={loading} />

          {/* Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stake */}
            <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
              <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
              <h3 className="text-xl text-green-500 uppercase mb-4">STAKE $DOD</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-green-500 uppercase">AMOUNT TO STAKE</span>
                    <span className="text-sm text-amber-500 uppercase">BALANCE: {formatToken(userBalance)}</span>
                  </div>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      className="flex-1 bg-green-950/80 border-2 border-green-500 text-green-500 p-2 font-mono rounded-sm focus:outline-none focus:border-green-400 placeholder:text-green-500/50"
                      placeholder="Enter amount"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      step="0.000001"
                      min="0"
                    />
                    <button
                      className="bg-green-500/10 border-2 border-green-500 text-green-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-green-500/20 hover:border-green-400 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setStakeAmount((Number(userBalance) / 1e6).toFixed(6))}
                      disabled={userBalance === 0n}
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <button
                  className={`w-full bg-green-500/10 border-2 border-green-500 text-green-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-green-500/20 hover:border-green-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading ? 'crt-pulse' : ''}`}
                  onClick={handleStake}
                  disabled={loading || !stakeAmount || userBalance === 0n || !config.appId}
                >
                  {loading ? 'STAKING...' : 'STAKE'}
                </button>
              </div>
            </div>

            {/* Withdraw */}
            <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-4 relative">
              <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
              <h3 className="text-xl text-green-500 uppercase mb-4">WITHDRAW $DOD</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-green-500 uppercase">AMOUNT TO WITHDRAW</span>
                    <span className="text-sm text-amber-500 uppercase">STAKED: {formatToken(stakedAmount)}</span>
                  </div>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      className="flex-1 bg-green-950/80 border-2 border-green-500 text-green-500 p-2 font-mono rounded-sm focus:outline-none focus:border-green-400 placeholder:text-green-500/50"
                      placeholder="Enter amount"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      step="0.000001"
                      min="0"
                    />
                    <button
                      className="bg-green-500/10 border-2 border-green-500 text-green-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-green-500/20 hover:border-green-400 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setWithdrawAmount((Number(stakedAmount) / 1e6).toFixed(6))}
                      disabled={stakedAmount === 0n}
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <button
                  className={`w-full bg-amber-500/10 border-2 border-amber-500 text-amber-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-amber-500/20 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed ${loading ? 'crt-pulse' : ''}`}
                  onClick={handleWithdraw}
                  disabled={loading || !withdrawAmount || stakedAmount === 0n}
                >
                  {loading ? 'WITHDRAWING...' : 'WITHDRAW'}
                </button>
              </div>
            </div>
          </div>

          {/* Admin Panel */}
          <AdminPanel contractClient={contractClient} appGlobalState={appGlobalState} loading={loading} onStateUpdate={loadContractStats} />
        </div>
      </div>
    </div>
  )
}

export default SimpleStakingDashboard
