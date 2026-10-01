import type { SignedRegistration } from "../shared/types.ts";
import { AttestationVerifier, type EnclavePolicy } from "./index.ts";
import { RegistrationService } from "./service.ts";
import { type NullifierStore, type StoredRegistration } from "./store.ts";
/**
 * Framework-agnostic registration facade for the NestJS backend. The controller
 * stays thin: parse the body, call submit(), map errors to HTTP statuses.
 *
 *   const sixfigs = new SixFigsVerification({
 *     audience: "6figs-registration",
 *     policy: {
 *       allowedImageDigests: [process.env.SIXFIGS_IMAGE_DIGEST!],
 *       allowedProjects: [process.env.SIXFIGS_GCP_PROJECT!],
 *       requiredSupportAttributes: ["STABLE"],
 *       allowDebug: false,
 *     },
 *     store: new PostgresNullifierStore(pool),
 *   });
 *
 *   @Post("verify")
 *   async verify(@Body() body: SignedRegistration) {
 *     return this.sixfigs.submit(body, { requestNonce: body.body.nonce });
 *   }
 */
export interface SixFigsVerificationOptions {
    audience: string;
    policy: EnclavePolicy;
    store: NullifierStore;
    allowMock?: boolean;
    expectedPolicyVersion?: string;
    /** Live logger; defaults to console. */
    logger?: Pick<Console, "warn" | "error">;
}
export declare class SixFigsVerification {
    readonly verifier: AttestationVerifier;
    readonly service: RegistrationService;
    private readonly logger;
    constructor(options: SixFigsVerificationOptions);
    submit(signed: SignedRegistration, context?: {
        requestNonce?: string;
    }): Promise<StoredRegistration>;
    /** Helper for local development and tests. */
    static inMemory(options: Omit<SixFigsVerificationOptions, "store">): SixFigsVerification;
}
