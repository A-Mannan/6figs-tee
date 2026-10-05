import type { Disclosure } from "../shared/constants.ts";
import type { EnclaveHello, SignedEnvelope, SignedRegistration } from "../shared/types.ts";
import { type ClientAttestationPolicy } from "./attestation.ts";
export interface WalletDescriptor {
    family: "evm" | "solana";
    chainId: number;
    address: string;
    /** Optional wallet app label (e.g. "Phantom") carried into the result. */
    label?: string;
}
export interface PreparedRegistration {
    nonce: string;
    timestamp: number;
    identityNullifier: string;
    /** The exact string every enrolled wallet must sign to prove ownership. */
    message: string;
    wallets: WalletDescriptor[];
    disclosure: Disclosure;
    /** Wallets being detached in this transition. */
    removals: WalletDescriptor[];
    /** Removal consent string per removed wallet, keyed `family:lowercaseAddress`. */
    removalMessages: Record<string, string>;
}
/** Prepared single-signature addition of one or more new wallets. */
export interface PreparedAddition {
    nonce: string;
    timestamp: number;
    /** The stored account identity being extended (from the backend). */
    accountIdentityNullifier: string;
    /** The stored set, ciphertext to the escrow key; forwarded opaquely. */
    escrowBlob: SignedEnvelope;
    added: WalletDescriptor[];
    disclosure: Disclosure;
    /** Addition consent string per added wallet, keyed `family:lowercaseAddress`. */
    addMessages: Record<string, string>;
}
/** Prepared threshold removal: every kept wallet signs one shared challenge. */
export interface PreparedRemoval {
    nonce: string;
    timestamp: number;
    /** The stored account identity being pruned (from the backend). */
    accountIdentityNullifier: string;
    /** The stored set, ciphertext to the escrow key; forwarded opaquely. */
    escrowBlob: SignedEnvelope;
    kept: WalletDescriptor[];
    remove: WalletDescriptor[];
    /** The exact string every kept wallet must sign. */
    message: string;
    disclosure: Disclosure;
}
export interface RegistrationClientOptions {
    enclaveUrl: string;
    policy?: ClientAttestationPolicy;
    fetchImpl?: typeof fetch;
}
/**
 * Two-phase registration client:
 *
 *   1. prepare()  — verifies the enclave attestation, generates the request
 *                   nonce (or adopts a caller-supplied session nonce), and
 *                   returns the message to sign.
 *   2. submit()   — takes the wallet signatures over that message, encrypts
 *                   everything to the enclave, and returns the verified result.
 *
 * The secret and nonce never leave the page except encrypted to the enclave.
 */
export declare class RegistrationClient {
    private readonly fetchImpl;
    private readonly options;
    private helloCache;
    constructor(options: RegistrationClientOptions);
    hello(): Promise<EnclaveHello>;
    /**
     * Phase 1: verify the enclave and produce the messages wallets must sign.
     * `wallets` is the set to keep; `remove` lists wallets to detach. The
     * backend infers the previous account from its stored bindings, so the
     * client never needs to know it; every enrolled wallet must still sign,
     * which is what makes silent shrinkage impossible.
     */
    prepare(input: {
        wallets: WalletDescriptor[];
        remove?: WalletDescriptor[];
        disclosure?: Disclosure;
        timestamp?: number;
        /** Caller session nonce, echoed into the request so the backend can bind
         * the result to its session. Must be at least 8 characters; the enclave
         * enforces the minimum. Generated randomly when omitted. */
        nonce?: string;
    }): PreparedRegistration;
    /** Phase 2: submit signatures and get the verified signed result. */
    submit(input: {
        prepared: PreparedRegistration;
        signatures: Record<string, string>;
        removalSignatures?: Record<string, string>;
    }): Promise<SignedRegistration>;
    /**
     * Phase 1 for an addition: build the compact consent message each added
     * wallet signs. The stored escrow blob is forwarded opaquely — the browser
     * never needs the old addresses, and the enclave recomputes the account
     * identity from the blob before accepting anything.
     */
    prepareAddition(input: {
        added: WalletDescriptor[];
        escrowBlob: SignedEnvelope;
        accountIdentityNullifier: string;
        nonce?: string;
        disclosure?: Disclosure;
        timestamp?: number;
    }): PreparedAddition;
    /** Phase 2 for an addition: submit only the added wallets' signatures. */
    submitAddition(input: {
        prepared: PreparedAddition;
        signatures: Record<string, string>;
    }): Promise<SignedRegistration>;
    /**
     * Phase 1 for a threshold removal: every kept wallet will sign the same
     * compact consent naming the removed wallets. The removed wallets are not
     * connected and sign nothing.
     */
    prepareRemoval(input: {
        kept: WalletDescriptor[];
        remove: WalletDescriptor[];
        escrowBlob: SignedEnvelope;
        accountIdentityNullifier: string;
        nonce?: string;
        disclosure?: Disclosure;
        timestamp?: number;
    }): PreparedRemoval;
    /** Phase 2 for a threshold removal: submit the kept wallets' signatures. */
    submitRemoval(input: {
        prepared: PreparedRemoval;
        signatures: Record<string, string>;
    }): Promise<SignedRegistration>;
}
export declare class RegistrationClientError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
