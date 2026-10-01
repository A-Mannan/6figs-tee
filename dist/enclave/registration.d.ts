import { type NullifierScheme } from "../shared/nullifiers.ts";
import type { RegistrationRequest, SignedRegistration } from "../shared/types.ts";
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
}
export declare class RegistrationError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function registerPortfolio(request: RegistrationRequest, deps: RegistrationDeps): Promise<SignedRegistration>;
