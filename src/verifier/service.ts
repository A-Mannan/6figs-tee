import { walletSetNullifier } from "../shared/nullifiers.ts";
import type { SignedRegistration } from "../shared/types.ts";
import { AttestationVerifier, VerificationError, type VerifierConfig } from "./index.ts";
import {
  recordFromBody,
  type NullifierStore,
  type StoredRegistration,
} from "./store.ts";

export interface RegistrationServiceOptions {
  verifier: AttestationVerifier;
  store: NullifierStore;
  expectedPolicyVersion?: string;
}

export class RegistrationService {
  private readonly options: RegistrationServiceOptions;

  constructor(options: RegistrationServiceOptions) {
    this.options = options;
  }

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
  async submit(
    signed: SignedRegistration,
    context: { requestNonce?: string } = {},
  ): Promise<StoredRegistration> {
    const body = await this.options.verifier.verifyRegistration(signed, {
      ...(context.requestNonce ? { expectedNonce: context.requestNonce } : {}),
      ...(this.options.expectedPolicyVersion
        ? { expectedPolicyVersion: this.options.expectedPolicyVersion }
        : {}),
    });

    return this.options.store.runTransaction(async (store) => {
      const kept = body.walletNullifiers;
      const removed = body.removedWalletNullifiers ?? [];
      const keptIds = kept.map((w) => w.walletNullifier);
      const removedIds = removed.map((w) => w.walletNullifier);
      const allIds = [...keptIds, ...removedIds];

      const owners = await store.getWalletOwners(allIds);
      const previousIdentities = new Set(owners.values());

      if (removed.length > 0) {
        if (previousIdentities.size !== 1) {
          throw new RegistrationConflict(allIds[0]!);
        }
        const previous = [...previousIdentities][0]!;
        const previousEntries = await store.listWallets(previous);
        if (walletSetNullifier(previousEntries) !== previous) {
          throw new RegistrationConflict(allIds[0]!);
        }
        const previousIds = previousEntries.map((entry) => entry.walletNullifier);
        // Every wallet enrolled before the transition must be accounted for:
        // either it stays (and re-signed the new set) or it consents to removal.
        const union = new Set(allIds);
        const missing = previousIds.filter((wallet) => !union.has(wallet));
        if (missing.length > 0) throw new RegistrationConflict(missing[0]!);
        const unenrolled = removedIds.filter((wallet) => !previousIds.includes(wallet));
        if (unenrolled.length > 0) throw new RegistrationConflict(unenrolled[0]!);
        await store.migrateWallets(previous, body.identityNullifier, kept, removedIds);
      } else if (previousIdentities.size === 0) {
        const binding = await store.bindWallets(body.identityNullifier, kept);
        if (!binding.ok) {
          throw new RegistrationConflict(binding.conflict);
        }
      } else if (previousIdentities.size === 1) {
        const previous = [...previousIdentities][0]!;
        if (previous !== body.identityNullifier) {
          const previousEntries = await store.listWallets(previous);
          if (walletSetNullifier(previousEntries) !== previous) {
            throw new RegistrationConflict(allIds[0]!);
          }
          const missing = previousEntries.filter(
            (entry) => !keptIds.includes(entry.walletNullifier),
          );
          if (missing.length > 0) throw new RegistrationConflict(missing[0]!.walletNullifier);
          await store.migrateWallets(previous, body.identityNullifier, kept);
        }
      } else {
        throw new RegistrationConflict(allIds[0]!);
      }

      const record = recordFromBody(body);
      await store.upsertRegistration(record);
      return record;
    });
  }
}

export class RegistrationConflict extends Error {
  readonly walletNullifier: string;

  constructor(walletNullifier: string) {
    super("the wallet set transition conflicts with the enrolled account");
    this.walletNullifier = walletNullifier;
  }
}

export { AttestationVerifier, VerificationError };
export type { VerifierConfig };