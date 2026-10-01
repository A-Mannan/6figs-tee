import type { EscrowWallet, SignedEnvelope } from "../shared/types.ts";
/**
 * Encrypt the wallet set to the enclave escrow key so the backend can store it
 * without ever reading an address. The blob is only decrypted inside the
 * enclave during a recheck.
 */
export declare function encryptEscrowBlob(escrowPublicKey: string, wallets: readonly EscrowWallet[]): Promise<SignedEnvelope>;
