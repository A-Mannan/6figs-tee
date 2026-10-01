import type { Disclosure } from "../shared/constants.ts";
import type { EnclaveHello, SignedRegistration } from "../shared/types.ts";
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
}
export declare class RegistrationClientError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
