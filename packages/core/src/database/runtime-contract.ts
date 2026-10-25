import runtimeContract from './runtime-contract.generated.json'
import { DEFAULT_PEER_JWT_LIFETIME_SECONDS } from '../auth/defaults'

export const peerJwtContract = {
  ...runtimeContract.jwt,
  /** @deprecated Legacy signing default, not the connected database's admission limit. */
  maximum_lifetime_seconds: DEFAULT_PEER_JWT_LIFETIME_SECONDS,
}
export const databaseRuntimeContract = {
  format: runtimeContract.format,
  revision: runtimeContract.revision,
  protocol: {
    format: runtimeContract.protocol.format,
    schema: runtimeContract.protocol.schema,
  },
  jwt: peerJwtContract,
}

export type DatabaseRuntimeContract = typeof databaseRuntimeContract
