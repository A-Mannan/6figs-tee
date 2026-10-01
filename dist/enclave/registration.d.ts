import { type NullifierScheme } from "../shared/nullifiers.ts";
import type { RecheckPayload, RegistrationRequest, SignedRegistration } from "../shared/types.ts";
import type { EnclaveKeys } from "../shared/attestation.ts";
import type { AttestationProvider } from "./attestation-provider.ts";
import { type PricingProvider } from "./pricing.ts";
export interface RegistrationDeps {
    keys: EnclaveKeys;
    attestation: AttestationProvider;
    pricing: PricingProvider;
    /** Nullifier scheme for the emitted nullifiers; the challenge always binds
     * the legacy set commitment so clients need no secret to sign. */
    nullifier: NullifierScheme;
    env?: NodeJS.ProcessEnv;
    /** Rechecks require persistent escrow material; absent means refuse. */
    escrowPersistent?: boolean;
}
export declare class RegistrationError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function registerPortfolio(request: RegistrationRequest, deps: RegistrationDeps): Promise<SignedRegistration>;
/**
 * Recheck a stored escrow blob: decrypt with the enclave escrow key, refuse a
 * blob whose recomputed identity differs from the claimed one, re-fetch
 * balances and prices, and return a fresh signed, attested result. Possession
 * of the blob is the capability; no wallet signatures are required.
 */
export declare function recheckPortfolio(payload: RecheckPayload, deps: RegistrationDeps): Promise<SignedRegistration>;
