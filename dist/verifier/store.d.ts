import type { RegistrationResultBody, WalletNullifierEntry } from "../shared/types.ts";
export interface StoredRegistration {
    identityNullifier: string;
    tier: number;
    tierLabel: string;
    portfolioBand: string;
    stableBps: number;
    createdAt: number;
    expiresAt: number;
}
export interface NullifierStore {
    /** Returns the existing record for an identity, if any. */
    getIdentity(identityNullifier: string): Promise<StoredRegistration | null>;
    /**
     * Atomically bind wallet entries to a fresh identity. Returns the conflicting
     * wallet nullifier when any is already bound elsewhere.
     */
    bindWallets(identityNullifier: string, walletNullifiers: readonly WalletNullifierEntry[]): Promise<{
        ok: true;
    } | {
        ok: false;
        conflict: string;
    }>;
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
    migrateWallets(previousIdentity: string, nextIdentity: string, walletNullifiers: readonly WalletNullifierEntry[], removedWalletNullifiers?: readonly string[]): Promise<void>;
    upsertRegistration(record: StoredRegistration): Promise<void>;
    /**
     * Execute fn atomically: concurrent calls serialize, and a SQL store runs fn
     * inside one locked transaction. The service performs its entire
     * read-check-mutate sequence inside this boundary. Do not nest calls.
     */
    runTransaction<T>(fn: (store: NullifierStore) => Promise<T>): Promise<T>;
}
/** Reference in-memory implementation. Production uses the SQL schema in db/. */
export declare class InMemoryNullifierStore implements NullifierStore {
    private readonly identities;
    private readonly bindings;
    private readonly mutex;
    getIdentity(identityNullifier: string): Promise<StoredRegistration | null>;
    bindWallets(identityNullifier: string, walletNullifiers: readonly WalletNullifierEntry[]): Promise<{
        ok: true;
    } | {
        ok: false;
        conflict: string;
    }>;
    getWalletOwners(walletNullifiers: readonly string[]): Promise<Map<string, string>>;
    listWallets(identityNullifier: string): Promise<WalletNullifierEntry[]>;
    migrateWallets(previousIdentity: string, nextIdentity: string, walletNullifiers: readonly WalletNullifierEntry[], removedWalletNullifiers?: readonly string[]): Promise<void>;
    upsertRegistration(record: StoredRegistration): Promise<void>;
    runTransaction<T>(fn: (store: NullifierStore) => Promise<T>): Promise<T>;
}
export declare function recordFromBody(body: RegistrationResultBody): StoredRegistration;
