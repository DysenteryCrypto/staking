import { Uint64 } from "@algorandfoundation/algorand-typescript"

export const ROUNDS_PER_DAY = Uint64(30857) // (24 * 60 * 60) / 2.8
export const ROUNDS_PER_YEAR = Uint64(11262857) // 365 * 24 * 60 * 60 / 2.8