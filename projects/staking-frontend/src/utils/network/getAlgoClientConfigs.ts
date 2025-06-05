import { AlgoViteClientConfig, AlgoViteKMDConfig, StakingConfig } from '../../interfaces/network'

export function getAlgodConfigFromViteEnvironment(): AlgoViteClientConfig {
  if (!import.meta.env.VITE_ALGOD_SERVER) {
    throw new Error('Attempt to get default algod configuration without specifying VITE_ALGOD_SERVER in the environment variables')
  }

  return {
    server: import.meta.env.VITE_ALGOD_SERVER,
    port: import.meta.env.VITE_ALGOD_PORT,
    token: import.meta.env.VITE_ALGOD_TOKEN,
    network: import.meta.env.VITE_ALGOD_NETWORK,
  }
}

export function getIndexerConfigFromViteEnvironment(): AlgoViteClientConfig {
  if (!import.meta.env.VITE_INDEXER_SERVER) {
    throw new Error('Attempt to get default algod configuration without specifying VITE_INDEXER_SERVER in the environment variables')
  }

  return {
    server: import.meta.env.VITE_INDEXER_SERVER,
    port: import.meta.env.VITE_INDEXER_PORT,
    token: import.meta.env.VITE_INDEXER_TOKEN,
    network: import.meta.env.VITE_ALGOD_NETWORK,
  }
}

export function getKmdConfigFromViteEnvironment(): AlgoViteKMDConfig {
  if (!import.meta.env.VITE_KMD_SERVER) {
    throw new Error('Attempt to get default kmd configuration without specifying VITE_KMD_SERVER in the environment variables')
  }

  return {
    server: import.meta.env.VITE_KMD_SERVER,
    port: import.meta.env.VITE_KMD_PORT,
    token: import.meta.env.VITE_KMD_TOKEN,
    wallet: import.meta.env.VITE_KMD_WALLET,
    password: import.meta.env.VITE_KMD_PASSWORD,
  }
}

export function getStakingConfigFromViteEnvironment(): StakingConfig {
  if (!import.meta.env.VITE_STAKING_ASA_ID || !import.meta.env.VITE_STAKING_APP_ID) {
    throw new Error('Attempt to get staking configuration without specifying STAKING_ASA_ID or STAKING_APP_ID in the environment variables')
  }

  return {
    asaId: import.meta.env.VITE_STAKING_ASA_ID,
    appId: import.meta.env.VITE_STAKING_APP_ID,
  }
}
