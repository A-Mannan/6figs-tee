import { type IncomingMessage, type ServerResponse } from "node:http";
import { type AttestationProvider } from "./attestation-provider.ts";
import { EnclaveKeyManager } from "./keys.ts";
import type { EscrowKeyProvider } from "./key-provider.ts";
import { type NullifierScheme } from "../shared/nullifiers.ts";
import { type PricingProvider } from "./pricing.ts";
export interface EnclaveServerOptions {
    env?: NodeJS.ProcessEnv;
    attestation?: AttestationProvider;
    pricing?: PricingProvider;
    /** Test/DI hook; selected from the environment when omitted. */
    escrowKeyProvider?: EscrowKeyProvider;
    port?: number;
    host?: string;
}
export declare function createEnclaveServer(options?: EnclaveServerOptions): {
    server: import("http").Server<typeof IncomingMessage, typeof ServerResponse>;
    keyManager: EnclaveKeyManager;
    nullifier: NullifierScheme;
    attestation: AttestationProvider;
    pricing: PricingProvider;
    listen(): Promise<{
        port: number;
        host: string;
    }>;
};
/**
 * The nullifier scheme is a privacy decision, not just configuration: without
 * a key, wallet nullifiers are computable offline by anyone. A KMS-wrapped key
 * is released at boot through the provider; the environment key is the
 * dev/staging fallback; production refuses to boot keyless so the guarantee
 * cannot silently degrade.
 */
export declare function selectNullifierScheme(env: NodeJS.ProcessEnv): NullifierScheme;
