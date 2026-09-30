import type { SignedRegistration } from "../shared/types.ts";
import { AttestationVerifier, VerificationError, type EnclavePolicy } from "./index.ts";
import { RegistrationConflict, RegistrationService } from "./service.ts";
import {
  InMemoryNullifierStore,
  type NullifierStore,
  type StoredRegistration,
} from "./store.ts";

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

export class SixFigsVerification {
  readonly verifier: AttestationVerifier;
  readonly service: RegistrationService;
  private readonly logger: Pick<Console, "warn" | "error">;

  constructor(options: SixFigsVerificationOptions) {
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

  async submit(
    signed: SignedRegistration,
    context: { requestNonce?: string } = {},
  ): Promise<StoredRegistration> {
    try {
      return await this.service.submit(signed, context);
    } catch (error) {
      // Codes only: logs must never carry addresses, balances, signatures,
      // or anything that identifies a user.
      if (error instanceof RegistrationConflict) {
        this.logger.warn("sixfigs registration conflict");
      } else if (error instanceof VerificationError) {
        this.logger.warn(`sixfigs verification rejected: ${error.code}`);
      } else {
        this.logger.error("sixfigs verification failed: internal error");
      }
      throw error;
    }
  }

  /** Helper for local development and tests. */
  static inMemory(options: Omit<SixFigsVerificationOptions, "store">): SixFigsVerification {
    return new SixFigsVerification({ ...options, store: new InMemoryNullifierStore() });
  }
}