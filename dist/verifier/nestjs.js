import { AttestationVerifier, VerificationError } from "./index.js";
import { RegistrationConflict, RegistrationService } from "./service.js";
import { InMemoryNullifierStore, } from "./store.js";
export class SixFigsVerification {
    verifier;
    service;
    logger;
    constructor(options) {
        this.verifier = new AttestationVerifier({
            audience: options.audience,
            policy: options.policy,
            ...(options.allowMock !== undefined ? { allowMock: options.allowMock } : {}),
        });
        this.service = new RegistrationService({
            verifier: this.verifier,
            store: options.store,
            ...(options.expectedPolicyVersion
                ? { expectedPolicyVersion: options.expectedPolicyVersion }
                : {}),
        });
        this.logger = options.logger ?? console;
    }
    async submit(signed, context = {}) {
        try {
            return await this.service.submit(signed, context);
        }
        catch (error) {
            // Codes only: logs must never carry addresses, balances, signatures,
            // or anything that identifies a user.
            if (error instanceof RegistrationConflict) {
                this.logger.warn("sixfigs registration conflict");
            }
            else if (error instanceof VerificationError) {
                this.logger.warn(`sixfigs verification rejected: ${error.code}`);
            }
            else {
                this.logger.error("sixfigs verification failed: internal error");
            }
            throw error;
        }
    }
    /** Helper for local development and tests. */
    static inMemory(options) {
        return new SixFigsVerification({ ...options, store: new InMemoryNullifierStore() });
    }
}
