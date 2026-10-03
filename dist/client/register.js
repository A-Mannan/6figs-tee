import { ownershipChallenge, walletAdditionChallenge, walletRemovalChallenge, } from "../shared/constants.js";
import { base64urlToBytes, bytesToBase64url, randomBytes } from "../shared/crypto.js";
import { encryptEnvelope } from "../shared/envelope.js";
import { walletEntriesFromAddresses, walletSetNullifier } from "../shared/nullifiers.js";
import { verifyHello, verifyRegistrationAttestation, } from "./attestation.js";
function descriptorKey(wallet) {
    return `${wallet.family}:${wallet.address.toLowerCase()}`;
}
/**
 * Two-phase registration client:
 *
 *   1. prepare()  — verifies the enclave attestation, generates the request
 *                   nonce (or adopts a caller-supplied session nonce), and
 *                   returns the message to sign.
 *   2. submit()   — takes the wallet signatures over that message, encrypts
 *                   everything to the enclave, and returns the verified result.
 *
 * The secret and nonce never leave the page except encrypted to the enclave.
 */
export class RegistrationClient {
    fetchImpl;
    options;
    helloCache = null;
    constructor(options) {
        this.options = options;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }
    async hello() {
        if (this.helloCache && Date.now() - this.helloCache.at < 60_000) {
            return this.helloCache.hello;
        }
        const response = await this.fetchImpl(`${this.options.enclaveUrl}/hello`);
        if (!response.ok)
            throw new Error(`enclave hello failed: ${response.status}`);
        const hello = (await response.json());
        await verifyHello(hello, this.options.policy ?? {});
        this.helloCache = { at: Date.now(), hello };
        return hello;
    }
    /**
     * Phase 1: verify the enclave and produce the messages wallets must sign.
     * `wallets` is the set to keep; `remove` lists wallets to detach. The
     * backend infers the previous account from its stored bindings, so the
     * client never needs to know it; every enrolled wallet must still sign,
     * which is what makes silent shrinkage impossible.
     */
    prepare(input) {
        const nonce = input.nonce ?? bytesToBase64url(randomBytes(24));
        const timestamp = input.timestamp ?? Date.now();
        const removals = input.remove ?? [];
        if (removals.length > 0 && input.wallets.length === 0) {
            throw new Error("at least one wallet must stay enrolled");
        }
        const identityNullifier = walletSetNullifier(walletEntriesFromAddresses(input.wallets));
        const message = ownershipChallenge({
            identityNullifier,
            wallets: input.wallets,
            timestamp,
            nonce,
        });
        const removalMessages = {};
        for (const wallet of removals) {
            removalMessages[descriptorKey(wallet)] = walletRemovalChallenge({
                family: wallet.family,
                address: wallet.address,
                nextIdentityNullifier: identityNullifier,
                timestamp,
                nonce,
            });
        }
        return {
            nonce,
            timestamp,
            identityNullifier,
            message,
            wallets: input.wallets,
            disclosure: input.disclosure ?? "hidden",
            removals,
            removalMessages,
        };
    }
    /** Phase 2: submit signatures and get the verified signed result. */
    async submit(input) {
        const hello = await this.hello();
        const { prepared, signatures } = input;
        const removalSignatures = input.removalSignatures ?? {};
        const wallets = prepared.wallets.map((wallet) => {
            const signature = signatures[descriptorKey(wallet)];
            if (!signature)
                throw new Error(`missing signature for wallet ${wallet.address}`);
            return {
                family: wallet.family,
                chainId: wallet.chainId,
                address: wallet.address,
                signature,
                ...(wallet.label ? { label: wallet.label } : {}),
            };
        });
        const removals = prepared.removals.map((wallet) => {
            const signature = removalSignatures[descriptorKey(wallet)];
            if (!signature)
                throw new Error(`missing removal signature for wallet ${wallet.address}`);
            return {
                family: wallet.family,
                chainId: wallet.chainId,
                address: wallet.address,
                signature,
            };
        });
        const request = {
            nonce: prepared.nonce,
            timestamp: prepared.timestamp,
            wallets,
            disclosure: prepared.disclosure,
            ...(removals.length > 0 ? { removals } : {}),
        };
        const envelope = await encryptEnvelope(base64urlToBytes(hello.encryptionPublicKey), { request });
        const response = await this.fetchImpl(`${this.options.enclaveUrl}/registration`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(envelope),
        });
        if (!response.ok) {
            const error = (await response.json().catch(() => ({})));
            throw new RegistrationClientError(error.error ?? "enclave_error", error.message ?? `registration failed (${response.status})`);
        }
        const result = (await response.json());
        await verifyRegistrationAttestation(result, this.options.policy ?? {});
        // The result must come from the enclave whose keys hello advertised.
        if (result.body.nullifierScheme !== hello.nullifierScheme) {
            throw new RegistrationClientError("scheme_mismatch", "enclave result uses an unexpected nullifier scheme");
        }
        // Only the legacy scheme is client-computable. Under a keyed scheme the
        // browser cannot recompute identities; the attested enclave and the
        // backend verifier own those checks.
        if (hello.nullifierScheme === "legacy-v1") {
            if (result.body.identityNullifier !== prepared.identityNullifier) {
                throw new RegistrationClientError("identity_mismatch", "enclave result is for a different wallet set");
            }
            if (removals.length > 0) {
                const expected = walletEntriesFromAddresses(prepared.removals)
                    .map((entry) => entry.walletNullifier)
                    .sort();
                const actual = (result.body.removedWalletNullifiers ?? [])
                    .map((entry) => entry.walletNullifier)
                    .sort();
                if (JSON.stringify(expected) !== JSON.stringify(actual)) {
                    throw new RegistrationClientError("transition_mismatch", "enclave result detached a different wallet set");
                }
            }
        }
        return result;
    }
    /**
     * Phase 1 for an addition: build the compact consent message each added
     * wallet signs. The stored escrow blob is forwarded opaquely — the browser
     * never needs the old addresses, and the enclave recomputes the account
     * identity from the blob before accepting anything.
     */
    prepareAddition(input) {
        if (input.added.length === 0)
            throw new Error("at least one wallet must be added");
        if (typeof input.accountIdentityNullifier !== "string" || input.accountIdentityNullifier.length === 0) {
            throw new Error("accountIdentityNullifier is required");
        }
        const nonce = input.nonce ?? bytesToBase64url(randomBytes(24));
        const timestamp = input.timestamp ?? Date.now();
        const addMessages = {};
        for (const wallet of input.added) {
            addMessages[descriptorKey(wallet)] = walletAdditionChallenge({
                family: wallet.family,
                address: wallet.address,
                accountIdentityNullifier: input.accountIdentityNullifier,
                timestamp,
                nonce,
            });
        }
        return {
            nonce,
            timestamp,
            accountIdentityNullifier: input.accountIdentityNullifier,
            escrowBlob: input.escrowBlob,
            added: input.added,
            disclosure: input.disclosure ?? "hidden",
            addMessages,
        };
    }
    /** Phase 2 for an addition: submit only the added wallets' signatures. */
    async submitAddition(input) {
        const hello = await this.hello();
        const { prepared, signatures } = input;
        const wallets = prepared.added.map((wallet) => {
            const signature = signatures[descriptorKey(wallet)];
            if (!signature)
                throw new Error(`missing signature for wallet ${wallet.address}`);
            return {
                family: wallet.family,
                chainId: wallet.chainId,
                address: wallet.address,
                signature,
                ...(wallet.label ? { label: wallet.label } : {}),
            };
        });
        const request = {
            nonce: prepared.nonce,
            timestamp: prepared.timestamp,
            mode: "add",
            escrowBlob: prepared.escrowBlob,
            baseIdentityNullifier: prepared.accountIdentityNullifier,
            wallets,
            disclosure: prepared.disclosure,
        };
        const envelope = await encryptEnvelope(base64urlToBytes(hello.encryptionPublicKey), { request });
        const response = await this.fetchImpl(`${this.options.enclaveUrl}/registration`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(envelope),
        });
        if (!response.ok) {
            const error = (await response.json().catch(() => ({})));
            throw new RegistrationClientError(error.error ?? "enclave_error", error.message ?? `addition failed (${response.status})`);
        }
        const result = (await response.json());
        await verifyRegistrationAttestation(result, this.options.policy ?? {});
        if (result.body.nullifierScheme !== hello.nullifierScheme) {
            throw new RegistrationClientError("scheme_mismatch", "enclave result uses an unexpected nullifier scheme");
        }
        if (result.body.previousIdentityNullifier !== prepared.accountIdentityNullifier) {
            throw new RegistrationClientError("base_identity_mismatch", "enclave extended a different account than requested");
        }
        if (!result.body.nextEscrowBlob || result.body.nextEscrowBlob.v !== 1) {
            throw new RegistrationClientError("escrow_missing", "enclave result carries no escrow blob for the merged set");
        }
        const addedEntries = result.body.addedWalletNullifiers ?? [];
        if (addedEntries.length !== prepared.added.length) {
            throw new RegistrationClientError("addition_mismatch", "enclave result added a different wallet count");
        }
        // Only the legacy scheme is client-computable; under a keyed scheme the
        // attested enclave and the backend verifier own these checks.
        if (hello.nullifierScheme === "legacy-v1") {
            const expected = walletEntriesFromAddresses(prepared.added)
                .map((entry) => entry.walletNullifier)
                .sort();
            const actual = addedEntries.map((entry) => entry.walletNullifier).sort();
            if (JSON.stringify(expected) !== JSON.stringify(actual)) {
                throw new RegistrationClientError("addition_mismatch", "enclave result added a different wallet set");
            }
        }
        return result;
    }
}
export class RegistrationClientError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
