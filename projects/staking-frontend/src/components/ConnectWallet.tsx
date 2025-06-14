import { useWallet, Wallet, WalletId } from '@txnlab/use-wallet-react'
import Account from './Account'

interface ConnectWalletInterface {
  openModal: boolean
  closeModal: () => void
}

const ConnectWallet = ({ openModal, closeModal }: ConnectWalletInterface) => {
  const { wallets, activeAddress } = useWallet()

  const isKmd = (wallet: Wallet) => wallet.id === WalletId.KMD

  return (
    <dialog id="connect_wallet_modal" className={`modal ${openModal ? 'modal-open' : ''}`}>
      <form method="dialog" className="modal-box bg-black border-2 border-green-500 rounded-md p-6 relative">
        <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />

        <h3 className="font-bold text-2xl text-green-500 uppercase mb-6">SELECT WALLET PROVIDER</h3>

        <div className="space-y-4">
          {activeAddress && (
            <>
              <Account />
              <div className="divider border-green-500/30" />
            </>
          )}

          {!activeAddress &&
            wallets?.map((wallet) => (
              <button
                data-test-id={`${wallet.id}-connect`}
                className="w-full bg-green-900/80 border-2 border-green-500 text-green-500 px-4 py-3 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-green-500/20 hover:border-green-400 flex items-center justify-center gap-3"
                key={`provider-${wallet.id}`}
                onClick={() => {
                  return wallet.connect()
                }}
              >
                {!isKmd(wallet) && <img alt={`wallet_icon_${wallet.id}`} src={wallet.metadata.icon} className="w-6 h-6 object-contain" />}
                <span>{isKmd(wallet) ? 'LOCALNET WALLET' : wallet.metadata.name.toUpperCase()}</span>
              </button>
            ))}
        </div>

        <div className="modal-action mt-6">
          <button
            data-test-id="close-wallet-modal"
            className="bg-green-500/10 border-2 border-green-500 text-green-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-green-500/20 hover:border-green-400"
            onClick={() => {
              closeModal()
            }}
          >
            CLOSE
          </button>
          {activeAddress && (
            <button
              className="bg-red-500/10 border-2 border-red-500 text-red-500 px-4 py-2 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-red-500/20 hover:border-red-400"
              data-test-id="logout"
              onClick={async () => {
                if (wallets) {
                  const activeWallet = wallets.find((w) => w.isActive)
                  if (activeWallet) {
                    await activeWallet.disconnect()
                  } else {
                    localStorage.removeItem('@txnlab/use-wallet:v3')
                    window.location.reload()
                  }
                }
              }}
            >
              LOGOUT
            </button>
          )}
        </div>
      </form>
    </dialog>
  )
}

export default ConnectWallet
