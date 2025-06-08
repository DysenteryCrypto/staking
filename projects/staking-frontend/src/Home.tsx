// src/components/Home.tsx
import { useWallet } from '@txnlab/use-wallet-react'
import React, { useState } from 'react'
import ConnectWallet from './components/ConnectWallet'
import SimpleStakingDashboard from './components/SimpleStakingDashboard'

interface HomeProps {}

const Home: React.FC<HomeProps> = () => {
  const [openWalletModal, setOpenWalletModal] = useState<boolean>(false)
  const { activeAddress } = useWallet()

  const toggleWalletModal = () => {
    setOpenWalletModal(!openWalletModal)
  }

  return (
    <div className="min-h-screen bg-black font-mono relative overflow-x-hidden">
      {/* Custom CSS for animations and effects */}
      <style>{`
        @keyframes flicker {
          0% { opacity: 1; }
          100% { opacity: 0.96; }
        }
        .crt-flicker { animation: flicker 0.15s infinite linear alternate; }
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

      <div className="">
        {/* Scanlines overlay */}
        <div className="absolute inset-0 crt-scanlines pointer-events-none z-10" />

        {/* Screen flicker overlay */}
        <div className="absolute inset-0 bg-green-500/[0.02] crt-flicker pointer-events-none z-10" />

        <div className="relative z-20">
          {!activeAddress ? (
            <div className="min-h-[calc(100vh-10rem)] flex flex-col items-center justify-center space-y-8">
              {/* Header */}
              <div className="text-center space-y-4">
                <h1 className="text-6xl font-bold text-green-500 uppercase tracking-wider">DIED OF DYSENTERY STAKING PLATFORM</h1>
                <div className="text-2xl text-green-400 uppercase tracking-wide">[ TERMINAL ACCESS REQUIRED ]</div>
                <p className="text-lg text-amber-500 uppercase tracking-wide">STAKE YOUR $DOD AND EARN REWARDS</p>
              </div>

              {/* Connection Card */}
              <div className="bg-green-900/80 border-2 border-green-500 rounded-md p-8 max-w-md w-full relative">
                <div className="absolute inset-1 border border-green-500/30 rounded-sm pointer-events-none" />
                <div className="text-center space-y-6">
                  <h2 className="text-2xl font-bold text-green-500 uppercase tracking-wide">WALLET CONNECTION</h2>
                  <div className="space-y-3">
                    <p className="text-green-400 uppercase">&gt; AUTHENTICATION REQUIRED</p>
                    <p className="text-white">CONNECT YOUR ALGORAND WALLET TO ACCESS THE STAKING TERMINAL</p>
                  </div>
                  <button
                    className="w-full bg-green-500/10 border-2 border-green-500 text-green-500 px-6 py-3 font-mono font-bold uppercase rounded-sm cursor-pointer transition-all duration-200 hover:bg-green-500/20 hover:border-green-400"
                    onClick={toggleWalletModal}
                  >
                    [ ESTABLISH CONNECTION ]
                  </button>
                </div>
              </div>

              {/* Terminal prompt */}
              <div className="text-center space-y-2">
                <div className="text-green-500 font-mono">&gt; WAITING FOR WALLET CONNECTION...</div>
                <div className="text-green-500/50 text-sm">SYSTEM STATUS: READY</div>
              </div>
            </div>
          ) : (
            <SimpleStakingDashboard />
          )}

          <ConnectWallet openModal={openWalletModal} closeModal={toggleWalletModal} />
        </div>
      </div>
    </div>
  )
}

export default Home
