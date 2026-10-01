import { base64urlToBytes } from "../shared/crypto.js";
import { encryptEnvelope } from "../shared/envelope.js";
/**
 * Encrypt the wallet set to the enclave escrow key so the backend can store it
 * without ever reading an address. The blob is only decrypted inside the
 * enclave during a recheck.
 */
export async function encryptEscrowBlob(escrowPublicKey, wallets) {
    if (wallets.length === 0)
        throw new Error("at least one wallet is required");
    const payload = { v: 1, wallets: [...wallets] };
    return encryptEnvelope(base64urlToBytes(escrowPublicKey), payload);
}
