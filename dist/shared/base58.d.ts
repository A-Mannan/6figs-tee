/**
 * Bitcoin-alphabet base58 decode, used for Solana public keys and signatures.
 * BigInt-based for clarity; inputs here are at most 64 bytes so speed is moot.
 */
export declare function base58Decode(input: string): Uint8Array;
/** Bitcoin-alphabet base58 encode. */
export declare function base58Encode(bytes: Uint8Array): string;
