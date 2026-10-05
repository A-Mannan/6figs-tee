import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { POLICY_VERSION } from "../shared/constants.ts";
import { decryptEnvelope } from "../shared/envelope.ts";
import type { EnvelopePayload, RecheckPayload, SignedEnvelope } from "../shared/types.ts";
import {
  ConfidentialSpaceAttestationProvider,
  MockAttestationProvider,
  type AttestationProvider,
} from "./attestation-provider.ts";
import { EnclaveKeyManager } from "./keys.ts";
import type { EscrowKeyProvider } from "./key-provider.ts";
import { ConcurrencyGate, FixedWindowRateLimiter, SeenNonces } from "./limits.ts";
import {
  keyedNullifierScheme,
  LEGACY_NULLIFIER_SCHEME,
  type NullifierScheme,
} from "../shared/nullifiers.ts";
import { hexToBytes } from "../shared/crypto.ts";
import {
  CoinGeckoPricing,
  DexScreenerPricing,
  GeckoTerminalPricing,
  type PricingProvider,
} from "./pricing.ts";
import { recheckPortfolio, registerPortfolio, RegistrationError } from "./registration.ts";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_CONCURRENT_REGISTRATIONS = 4;
const MAX_REGISTRATIONS_PER_MINUTE = 60;

export interface EnclaveServerOptions {
  env?: NodeJS.ProcessEnv;
  attestation?: AttestationProvider;
  pricing?: PricingProvider;
  /** Test/DI hook; selected from the environment when omitted. */
  escrowKeyProvider?: EscrowKeyProvider;
  port?: number;
  host?: string;
}

export function createEnclaveServer(options: EnclaveServerOptions = {}) {
  const env = options.env ?? process.env;
  // Mock attestation requires the explicit dev flag; NODE_ENV alone never
  // selects it.
  const useMock = env.SIXFIGS_MOCK_ATTESTATION === "1";
  const attestation =
    options.attestation ??
    (useMock
      ? new MockAttestationProvider(env)
      : new ConfidentialSpaceAttestationProvider(env));
  const devChains = env.SIXFIGS_DEV_CHAINS === "1";
  const priceTtl = env.SIXFIGS_PRICE_TTL_MS ? { ttlMs: Number(env.SIXFIGS_PRICE_TTL_MS) } : {};
  const pricing =
    options.pricing ??
    new CoinGeckoPricing({
      ...(env.COINGECKO_API_KEY ? { apiKey: env.COINGECKO_API_KEY } : {}),
      ...priceTtl,
      ...(devChains ? { devChains: true } : {}),
      fallback: new GeckoTerminalPricing({
        ...(env.GECKOTERMINAL_API_KEY ? { apiKey: env.GECKOTERMINAL_API_KEY } : {}),
        ...priceTtl,
        ...(devChains ? { devChains: true } : {}),
        fallback: new DexScreenerPricing({
          ...priceTtl,
          ...(devChains ? { devChains: true } : {}),
        }),
      }),
    });

  const nullifier = selectNullifierScheme(env);
  const keyManager = new EnclaveKeyManager(
    attestation,
    nullifier.name,
    env,
    options.escrowKeyProvider,
  );
  const seenNonces = new SeenNonces();
  const gate = new ConcurrencyGate(MAX_CONCURRENT_REGISTRATIONS);
  const limiter = new FixedWindowRateLimiter(MAX_REGISTRATIONS_PER_MINUTE, 60_000);
  // No wildcard fallback: when unset, no cross-origin headers are emitted.
  const allowedOrigin = env.SIXFIGS_ALLOWED_ORIGIN ?? null;

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      writeJson(res, 500, {
        error: "internal_error",
        message: "the enclave failed to process the request",
      });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCors(res, allowedOrigin);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/healthz") {
      writeJson(res, 200, {
        ok: true,
        policyVersion: POLICY_VERSION,
        provider: attestation.kind,
      });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/hello")) {
      writeJson(res, 200, await keyManager.hello(POLICY_VERSION));
      return;
    }

    if (req.method === "POST" && url.pathname === "/registration") {
      await handleRegistration(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/recheck") {
      await handleRecheck(req, res);
      return;
    }

    writeJson(res, 404, { error: "not_found", message: "unknown route" });
  }

  async function handleRegistration(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const clientIp = req.socket.remoteAddress ?? "unknown";
    if (!limiter.allow(clientIp)) {
      writeJson(res, 429, {
        error: "rate_limited",
        message: "too many registration attempts, try again later",
      });
      return;
    }
    if (!gate.tryEnter()) {
      writeJson(res, 503, {
        error: "server_busy",
        message: "the enclave is at capacity, try again later",
      });
      return;
    }
    try {
      await handleRegistrationInner(req, res);
    } finally {
      gate.leave();
    }
  }

  async function handleRegistrationInner(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let bodyText: string;
    try {
      bodyText = await readBody(req);
    } catch (error) {
      writeJson(res, 413, {
        error: "payload_too_large",
        message: error instanceof Error ? error.message : "body too large",
      });
      return;
    }

    let envelope: SignedEnvelope;
    try {
      envelope = JSON.parse(bodyText) as SignedEnvelope;
    } catch {
      writeJson(res, 400, { error: "bad_json", message: "body is not valid JSON" });
      return;
    }

    let payload;
    try {
      payload = await decryptEnvelope<EnvelopePayload>(keyManager.keys.encryptionPrivate, envelope);
    } catch {
      writeJson(res, 400, {
        error: "decrypt_failed",
        message: "could not decrypt request envelope",
      });
      return;
    }
    if (!payload || typeof payload !== "object" || !payload.request) {
      writeJson(res, 400, { error: "bad_envelope", message: "malformed registration payload" });
      return;
    }

    try {
      // Replays are rejected after the gate so 503s never burn a nonce and
      // honest retries keep working.
      const requestNonce = payload.request.nonce;
      if (typeof requestNonce !== "string" || seenNonces.seen(requestNonce)) {
        writeJson(res, 400, {
          error: "replay_detected",
          message: "this request was already processed",
        });
        return;
      }
      const signed = await registerPortfolio(payload.request, {
        keys: keyManager.keys,
        attestation,
        pricing,
        nullifier,
        env,
        escrowPersistent: keyManager.escrowPersistent,
      });
      writeJson(res, 200, signed);
    } catch (error) {
      if (error instanceof RegistrationError) {
        if (error.code === "budget_exceeded") {
          writeJson(res, 503, { error: error.code, message: error.message });
          return;
        }
        writeJson(res, 400, { error: error.code, message: error.message });
        return;
      }
      throw error;
    }
  }

  async function handleRecheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const clientIp = req.socket.remoteAddress ?? "unknown";
    if (!limiter.allow(clientIp)) {
      writeJson(res, 429, {
        error: "rate_limited",
        message: "too many requests, try again later",
      });
      return;
    }
    if (!gate.tryEnter()) {
      writeJson(res, 503, {
        error: "server_busy",
        message: "the enclave is at capacity, try again later",
      });
      return;
    }
    try {
      await handleRecheckInner(req, res);
    } finally {
      gate.leave();
    }
  }

  async function handleRecheckInner(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let bodyText: string;
    try {
      bodyText = await readBody(req);
    } catch (error) {
      writeJson(res, 413, {
        error: "payload_too_large",
        message: error instanceof Error ? error.message : "body too large",
      });
      return;
    }

    let envelope: SignedEnvelope;
    try {
      envelope = JSON.parse(bodyText) as SignedEnvelope;
    } catch {
      writeJson(res, 400, { error: "bad_json", message: "body is not valid JSON" });
      return;
    }

    let payload: RecheckPayload;
    try {
      payload = await decryptEnvelope<RecheckPayload>(
        keyManager.keys.encryptionPrivate,
        envelope,
      );
    } catch {
      writeJson(res, 400, {
        error: "decrypt_failed",
        message: "could not decrypt request envelope",
      });
      return;
    }

    try {
      if (typeof payload.nonce !== "string" || seenNonces.seen(payload.nonce)) {
        writeJson(res, 400, {
          error: "replay_detected",
          message: "this request was already processed",
        });
        return;
      }
      const signed = await recheckPortfolio(payload, {
        keys: keyManager.keys,
        attestation,
        pricing,
        nullifier,
        env,
        escrowPersistent: keyManager.escrowPersistent,
      });
      writeJson(res, 200, signed);
    } catch (error) {
      if (error instanceof RegistrationError) {
        if (error.code === "budget_exceeded") {
          writeJson(res, 503, { error: error.code, message: error.message });
          return;
        }
        writeJson(res, 400, { error: error.code, message: error.message });
        return;
      }
      throw error;
    }
  }

  return {
    server,
    keyManager,
    nullifier,
    attestation,
    pricing,
    async listen(): Promise<{ port: number; host: string }> {
      // The escrow key must be resolved before the first request: a
      // KMS-configured enclave that cannot unwrap its key must not answer.
      await keyManager.ensureEscrowLoaded();
      const port = options.port ?? Number(env.PORT ?? 8080);
      const host = options.host ?? env.HOST ?? "0.0.0.0";
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address();
          const actualPort = typeof address === "object" && address ? address.port : port;
          resolve({ port: actualPort, host });
        });
      });
    },
  };
}

/**
 * The nullifier scheme is a privacy decision, not just configuration: without
 * a key, wallet nullifiers are computable offline by anyone. Production
 * refuses to boot keyless so the guarantee cannot silently degrade.
 */
function selectNullifierScheme(env: NodeJS.ProcessEnv): NullifierScheme {
  const raw = env.SIXFIGS_NULLIFIER_KEY;
  if (raw !== undefined && raw !== "") {
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error("SIXFIGS_NULLIFIER_KEY must be 64 hex characters (32 bytes)");
    }
    return keyedNullifierScheme(hexToBytes(raw));
  }
  if (env.NODE_ENV === "production") {
    throw new Error("SIXFIGS_NULLIFIER_KEY is required in production");
  }
  return LEGACY_NULLIFIER_SCHEME;
}

function setCors(res: ServerResponse, origin: string | null): void {
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }
  res.setHeader("cache-control", "no-store");
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body exceeds limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Allow `node src/enclave/server.ts` to start the workload directly.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = createEnclaveServer();
  app.listen().then(({ host, port }) => {
    process.stdout.write(`6figs enclave listening on ${host}:${port}\n`);
  });
}