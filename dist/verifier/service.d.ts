import type { SignedRegistration } from "../shared/types.ts";
import { AttestationVerifier, VerificationError, type VerifierConfig } from "./index.ts";
import { type NullifierStore, type StoredRegistration } from "./store.ts";
export interface RegistrationServiceOptions {
    verifier: AttestationVerifier;
    store: NullifierStore;
    expectedPolicyVersion?: string;
}
export declare class RegistrationService {
    private readonly options;
    constructor(options: RegistrationServiceOptions);
    /**
     * Verify a submitted registration and, if valid, persist it idempotently.
     * This is the single function the NestJS controller should call.
     *
     * Membership policy:
     *  - a fresh set is bound to a new identity;
     *  - adding wallets is allowed only when every enrolled wallet re-signs;
     *  - removing wallets is allowed only when every enrolled wallet signs the
     *    transition — kept wallets sign the new set, removed wallets sign a
     *    removal consent. The previous account is inferred from stored bindings,
     *    never claimed by the client.
     *
     * The store sequence runs inside one transaction so concurrent submissions
     * for the same account serialize to a coherent state.
     */
    submit(signed: SignedRegistration, context?: {
        requestNonce?: string;
    }): Promise<StoredRegistration>;
}
export declare class RegistrationConflict extends Error {
    readonly walletNullifier: string;
    constructor(walletNullifier: string);
}
export { AttestationVerifier, VerificationError };
export type { VerifierConfig };
