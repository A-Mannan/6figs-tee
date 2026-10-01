/**
 * The enclave owns three keys:
 *  - an Ed25519 key that signs registration results (ephemeral to the VM run)
 *  - an X25519 key that decrypts client request envelopes (ephemeral)
 *  - an X25519 escrow key that decrypts stored address blobs for rechecks
 *    (persistent material provisioned to the enclave; never leaves it)
 * A key is proven to live inside a genuine enclave by the Confidential Space
 * attestation token binding sha256(signingPubkey || encryptionPubkey || escrowPubkey).
 */
export interface EnclaveKeys {
    signingPrivate: Uint8Array;
    signingPublic: Uint8Array;
    encryptionPrivate: Uint8Array;
    encryptionPublic: Uint8Array;
    escrowPrivate: Uint8Array;
    escrowPublic: Uint8Array;
}
export declare function generateEnclaveKeys(escrowPrivate?: Uint8Array): EnclaveKeys;
export declare function exportPublicKeys(keys: EnclaveKeys): {
    signingPublicKey: string;
    encryptionPublicKey: string;
    escrowPublicKey: string;
    keyId: string;
};
export declare function signResult(keys: EnclaveKeys, canonicalBody: string): string;
export declare function verifyResultSignature(signingPublicKey: string, canonicalBody: string, signature: string): boolean;
/**
 * The nonce passed to the attestation token. It binds a specific public key to
 * a specific payload hash so the token cannot be replayed for a different key
 * or a doctored result.
 */
export declare function bindingNonce(publicKey: Uint8Array, payload: string): string;
export declare function keyId(publicKey: Uint8Array): string;
/**
 * Nonce for the /hello key attestation. Covers all three public keys so a
 * token cannot be relayed with a substituted encryption or escrow key.
 */
export declare function keyAttestationNonce(signingPublicKey: Uint8Array, encryptionPublicKey: Uint8Array, escrowPublicKey: Uint8Array): string;
