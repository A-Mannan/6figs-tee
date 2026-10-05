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

      const previousIdentity = body.previousIdentityNullifier;
      if (previousIdentity !== undefined) {
        const previousEntries = await store.listWallets(previousIdentity);
        if (previousEntries.length === 0 || walletSetNullifier(previousEntries) !== previousIdentity) {
          throw new RegistrationConflict(keptIds[0] ?? removedIds[0]!);
        }
        const previousIds = new Set(previousEntries.map((entry) => entry.walletNullifier));
        const keptSet = new Set(keptIds);

        if (removed.length > 0) {
          // Removal: stored = kept ∪ removed exactly, with at least one kept.
          if (keptIds.length === 0) throw new RegistrationConflict(removedIds[0]!);
          const union = new Set(allIds);
          if (
            union.size !== previousIds.size ||
            [...previousIds].some((wallet) => !union.has(wallet)) ||
            removedIds.some((wallet) => !previousIds.has(wallet))
          ) {
            throw new RegistrationConflict(removedIds[0]!);
          }
          await store.migrateWallets(
            previousIdentity,
            body.identityNullifier,
            kept,
            removedIds,
          );
        } else {
          // Addition: strict superset with the claimed added set.
          if ([...previousIds].some((wallet) => !keptSet.has(wallet))) {
            throw new RegistrationConflict(keptIds[0]!);
          }
          const derivedAdded = keptIds.filter((wallet) => !previousIds.has(wallet));
          const claimed = new Set(
            (body.addedWalletNullifiers ?? []).map((entry) => entry.walletNullifier),
          );
          if (
            derivedAdded.length !== claimed.size ||
            derivedAdded.some((wallet) => !claimed.has(wallet))
          ) {
            throw new RegistrationConflict(keptIds[0]!);
          }
          await store.migrateWallets(previousIdentity, body.identityNullifier, kept);
        }
        const record = recordFromBody(body);
        await store.upsertRegistration(record);
        return record;
      }

      const owners = await store.getWalletOwners(allIds);
      const previousIdentities = new Set(owners.values());

      if (previousIdentities.size === 0) {
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