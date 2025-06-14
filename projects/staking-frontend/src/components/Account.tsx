import { useWallet } from '@txnlab/use-wallet-react'
import { useMemo } from 'react'
import { ellipseAddress } from '../utils/ellipseAddress'
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'

const Account = () => {
  const { activeAddress, wallets } = useWallet()
  const algoConfig = getAlgodConfigFromViteEnvironment()

  const networkName = useMemo(() => {
    return algoConfig.network === '' ? 'localnet' : algoConfig.network.toLocaleLowerCase()
  }, [algoConfig.network])

  const activeWallet = useMemo(() => {
    return wallets?.find((w) => w.isActive)
  }, [wallets])

  if (!activeAddress) return null

  const handleDisconnect = async () => {
    if (wallets) {
      const activeWallet = wallets.find((w) => w.isActive)
      if (activeWallet) {
        await activeWallet.disconnect()
      } else {
        localStorage.removeItem('@txnlab/use-wallet:v3')
        window.location.reload()
      }
    }
  }

  return (
    <div className="bg-green-900/80 rounded-md p-2 sm:p-3 relative">
      <div className="flex flex-col gap-0.5 sm:gap-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
        <div className="flex items-center gap-1 sm:gap-2">
            {activeWallet?.metadata?.icon && (
              <img src={activeWallet.metadata.icon} alt={activeWallet.metadata.name} className="w-4 h-4 sm:w-6 sm:h-6 object-contain" />
            )}
            <span className="text-green-500 uppercase text-xs sm:text-sm truncate max-w-[200px]">
              {activeWallet?.metadata?.name || 'Wallet'}
            </span>
          </div>
          <button
            className="hidden sm:block bg-red-500/10 text-red-500 px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-red-500/20 hover:text-red-400"
            onClick={handleDisconnect}
          >
            DISCONNECT
          </button>
        </div>
        <a
          className="text-cyan-400 hover:text-cyan-300 transition-colors duration-200 text-xs sm:text-sm font-mono truncate"
          target="_blank"
          href={`https://lora.algokit.io/${networkName}/account/${activeAddress}/`}
          rel="noopener noreferrer"
        >
          {ellipseAddress(activeAddress)}
        </a>
        <div className="flex justify-between items-center">
          <div className="text-amber-500 text-[10px] sm:text-xs uppercase">{networkName}</div>
          <button
            className="sm:hidden bg-red-500/10 text-red-500 px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-red-500/20 hover:text-red-400"
            onClick={handleDisconnect}
          >
            DISCONNECT
          </button>
        </div>
      </div>
    </div>
  )
}

export default Account
