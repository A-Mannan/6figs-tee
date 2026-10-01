import { base64urlToBytes } from "../shared/crypto.ts";
import { encryptEnvelope } from "../shared/envelope.ts";
import type { EscrowPayload, EscrowWallet, SignedEnvelope } from "../shared/types.ts";

/**
 * Encrypt the wallet set to the enclave escrow key so the backend can store it
 * without ever reading an address. The blob is only decrypted inside the
 * enclave during a recheck.
 */
export async function encryptEscrowBlob(
  escrowPublicKey: string,
  wallets: readonly EscrowWallet[],
): Promise<SignedEnvelope> {
  if (wallets.length === 0) throw new Error("at least one wallet is required");
  const payload: EscrowPayload = { v: 1, wallets: [...wallets] };
  return encryptEnvelope(base64urlToBytes(escrowPublicKey), payload);
}