import type { RegistrationResultBody, WalletNullifierEntry } from "../shared/types.ts";

export interface StoredRegistration {
  identityNullifier: string;
  tier: number;
  tierLabel: string;
  portfolioBand: string;
  createdAt: number;
  expiresAt: number;
}

interface WalletBinding {
  identityNullifier: string;
  family: WalletNullifierEntry["family"];
  chainId: number;
}

export interface NullifierStore {
  /** Returns the existing record for an identity, if any. */
  getIdentity(identityNullifier: string): Promise<StoredRegistration | null>;
  /**
   * Atomically bind wallet entries to a fresh identity. Returns the conflicting
   * wallet nullifier when any is already bound elsewhere.
   */
  bindWallets(
    identityNullifier: string,
    walletNullifiers: readonly WalletNullifierEntry[],
  ): Promise<{ ok: true } | { ok: false; conflict: string }>;
  /** Maps each already-bound wallet nullifier to its identity. */
  getWalletOwners(walletNullifiers: readonly string[]): Promise<Map<string, string>>;
  /** Every wallet entry currently bound to an identity. */
  listWallets(identityNullifier: string): Promise<WalletNullifierEntry[]>;
  /**
   * Rebind wallets from one identity to another, unbind removed wallets, and
   * drop the previous identity record. The caller has already proven the
   * transition against the signed wallet set. Must run in one transaction in a
   * real store.
   */
  migrateWallets(
    previousIdentity: string,
    nextIdentity: string,
    walletNullifiers: readonly WalletNullifierEntry[],
    removedWalletNullifiers?: readonly string[],
  ): Promise<void>;
  upsertRegistration(record: StoredRegistration): Promise<void>;
  /**
   * Execute fn atomically: concurrent calls serialize, and a SQL store runs fn
   * inside one locked transaction. The service performs its entire
   * read-check-mutate sequence inside this boundary. Do not nest calls.
   */
  runTransaction<T>(fn: (store: NullifierStore) => Promise<T>): Promise<T>;
}

/** Serializes async critical sections within one process. */
class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = gate;
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Reference in-memory implementation. Production uses the SQL schema in db/. */
export class InMemoryNullifierStore implements NullifierStore {
  private readonly identities = new Map<string, StoredRegistration>();
  private readonly bindings = new Map<string, WalletBinding>();
  private readonly mutex = new AsyncMutex();

  async getIdentity(identityNullifier: string): Promise<StoredRegistration | null> {
    return this.identities.get(identityNullifier) ?? null;
  }

  async bindWallets(
    identityNullifier: string,
    walletNullifiers: readonly WalletNullifierEntry[],
  ): Promise<{ ok: true } | { ok: false; conflict: string }> {
    for (const wallet of walletNullifiers) {
      const owner = this.bindings.get(wallet.walletNullifier);
      if (owner && owner.identityNullifier !== identityNullifier) {
        return { ok: false, conflict: wallet.walletNullifier };
      }
    }
    for (const wallet of walletNullifiers) {
      this.bindings.set(wallet.walletNullifier, {
        identityNullifier,
        family: wallet.family,
        chainId: wallet.chainId,
      });
    }
    return { ok: true };
  }

  async getWalletOwners(walletNullifiers: readonly string[]): Promise<Map<string, string>> {
    const owners = new Map<string, string>();
    for (const wallet of walletNullifiers) {
      const binding = this.bindings.get(wallet);
      if (binding) owners.set(wallet, binding.identityNullifier);
    }
    return owners;
  }

  async listWallets(identityNullifier: string): Promise<WalletNullifierEntry[]> {
    const wallets: WalletNullifierEntry[] = [];
    for (const [walletNullifier, binding] of this.bindings) {
      if (binding.identityNullifier === identityNullifier) {
        wallets.push({
          walletNullifier,
          family: binding.family,
          chainId: binding.chainId,
        });
      }
    }
    return wallets;
  }

  async migrateWallets(
    previousIdentity: string,
    nextIdentity: string,
    walletNullifiers: readonly WalletNullifierEntry[],
    removedWalletNullifiers: readonly string[] = [],
  ): Promise<void> {
    this.identities.delete(previousIdentity);
    for (const wallet of removedWalletNullifiers) {
      this.bindings.delete(wallet);
    }
    for (const wallet of walletNullifiers) {
      this.bindings.set(wallet.walletNullifier, {
        identityNullifier: nextIdentity,
        family: wallet.family,
        chainId: wallet.chainId,
      });
    }
  }

  async upsertRegistration(record: StoredRegistration): Promise<void> {
    this.identities.set(record.identityNullifier, record);
  }

  async runTransaction<T>(fn: (store: NullifierStore) => Promise<T>): Promise<T> {
    return this.mutex.run(() => fn(this));
  }
}

export function recordFromBody(body: RegistrationResultBody): StoredRegistration {
  return {
    identityNullifier: body.identityNullifier,
    tier: body.tier,
    tierLabel: body.tierLabel,
    portfolioBand: body.portfolioBand,
    createdAt: body.createdAt,
    expiresAt: body.expiresAt,
  };
}