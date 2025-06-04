import React, { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useSnackbar } from 'notistack'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'

interface AssetTransferProps {
  assetId: string
  amount: string
  recipient: string
  onSuccess?: () => void
  onError?: (error: Error) => void
}

const AssetTransfer: React.FC<AssetTransferProps> = ({ assetId, amount, recipient, onSuccess, onError }) => {
  const { activeAddress, signer } = useWallet()
  const { enqueueSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(false)

  const handleTransfer = async () => {
    if (!activeAddress || !signer || !assetId || !amount || !recipient) {
      enqueueSnackbar('Missing required parameters for transfer', { variant: 'error' })
      return
    }

    try {
      setLoading(true)

      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algorand = AlgorandClient.fromClients({
        algod: {
          baseServer: algodConfig.server,
          port: algodConfig.port,
          token: String(algodConfig.token),
        },
      })

      // Convert amount to base units (assuming 6 decimals)
      const transferAmount = BigInt(parseFloat(amount) * 1e6)

      // Create asset transfer transaction
      const txn = await algorand.client.algod
        .assetTransfer({
          from: activeAddress,
          to: recipient,
          amount: transferAmount,
          assetIndex: parseInt(assetId),
        })
        .do()

      // Sign and send transaction
      const signedTxn = await signer([txn], [0])
      const result = await algorand.client.algod.sendRawTransaction(signedTxn).do()

      enqueueSnackbar('Asset transfer successful!', { variant: 'success' })

      if (onSuccess) {
        onSuccess()
      }
    } catch (error) {
      console.error('Asset transfer failed:', error)
      enqueueSnackbar('Asset transfer failed', { variant: 'error' })

      if (onError) {
        onError(error as Error)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      className={`btn btn-primary ${loading ? 'loading' : ''}`}
      onClick={handleTransfer}
      disabled={loading || !activeAddress || !assetId || !amount || !recipient}
    >
      {loading ? 'Transferring...' : 'Transfer Asset'}
    </button>
  )
}

export default AssetTransfer
