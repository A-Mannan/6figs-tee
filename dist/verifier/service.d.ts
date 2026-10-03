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
     *  - an addition carries `previousIdentityNullifier` and is accepted only
     *    when the stored set is a subset of the new set and the claimed added
     *    entries are exactly the new wallets;
     *  - removals are not a product path and are rejected;
     *  - a full re-prove that grows the set without the addition fields must
     *    still include every enrolled wallet.
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
