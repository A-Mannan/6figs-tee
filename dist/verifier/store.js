/** Serializes async critical sections within one process. */
class AsyncMutex {
    tail = Promise.resolve();
    async run(fn) {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const previous = this.tail;
        this.tail = gate;
        await previous;
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
}
/** Reference in-memory implementation. Production uses the SQL schema in db/. */
export class InMemoryNullifierStore {
    identities = new Map();
    bindings = new Map();
    mutex = new AsyncMutex();
    async getIdentity(identityNullifier) {
        return this.identities.get(identityNullifier) ?? null;
    }
    async bindWallets(identityNullifier, walletNullifiers) {
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
    async getWalletOwners(walletNullifiers) {
        const owners = new Map();
        for (const wallet of walletNullifiers) {
            const binding = this.bindings.get(wallet);
            if (binding)
                owners.set(wallet, binding.identityNullifier);
        }
        return owners;
    }
    async listWallets(identityNullifier) {
        const wallets = [];
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
    async migrateWallets(previousIdentity, nextIdentity, walletNullifiers, removedWalletNullifiers = []) {
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
    async upsertRegistration(record) {
        this.identities.set(record.identityNullifier, record);
    }
    async runTransaction(fn) {
        return this.mutex.run(() => fn(this));
    }
}
export function recordFromBody(body) {
    return {
        identityNullifier: body.identityNullifier,
        tier: body.tier,
        tierLabel: body.tierLabel,
        portfolioBand: body.portfolioBand,
        createdAt: body.createdAt,
        expiresAt: body.expiresAt,
    };
}
