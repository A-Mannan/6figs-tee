import { base64urlToBytes } from "../shared/crypto.js";
import { encryptEnvelope } from "../shared/envelope.js";
import { verifyHello } from "./attestation.js";
import { RegistrationClientError } from "./register.js";
/**
 * Server-side helper for the backend trust boundary. It verifies the enclave
 * `/hello` attestation before sending anything, submits an escrow blob for
 * re-verification, and returns the raw signed result. Result signature,
 * attestation, and `expectedNonce` verification stay with the backend's
 * AttestationVerifier so there is a single verification implementation.
 */
export class RecheckClient {
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
    async recheck(input) {
        const hello = await this.hello();
        const payload = {
            escrowBlob: input.escrowBlob,
            identityNullifier: input.identityNullifier,
            nonce: input.nonce,
            timestamp: input.timestamp ?? Date.now(),
        };
        const envelope = await encryptEnvelope(base64urlToBytes(hello.encryptionPublicKey), payload);
        const response = await this.fetchImpl(`${this.options.enclaveUrl}/recheck`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(envelope),
        });
        if (!response.ok) {
            const error = (await response.json().catch(() => ({})));
            throw new RegistrationClientError(error.error ?? "enclave_error", error.message ?? `recheck failed (${response.status})`);
        }
        return (await response.json());
    }
}
