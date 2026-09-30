import { createPublicKey, createVerify, X509Certificate } from "node:crypto";
import { base64urlToBytes } from "../shared/crypto.ts";

export interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
}

export function parseJwt(token: string): JwtParts {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT must have three segments");
  const header = decodeJson(parts[0]!);
  const payload = decodeJson(parts[1]!);
  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: base64urlToBytes(parts[2]!),
  };
}

function decodeJson(segment: string): Record<string, unknown> {
  const parsed = JSON.parse(new TextDecoder().decode(base64urlToBytes(segment)));
  if (!parsed || typeof parsed !== "object") throw new Error("invalid JWT segment");
  return parsed as Record<string, unknown>;
}

export interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  x5c?: string[];
  alg?: string;
}

/** Verify an RS256 JWT with a JWKS document (Google OIDC flow). */
export function verifyRs256WithJwks(token: string, jwks: { keys: Jwk[] }): JwtParts {
  const jwt = parseJwt(token);
  if (jwt.header["alg"] !== "RS256") throw new Error("unexpected JWT alg");
  const kid = jwt.header["kid"];
  const candidates = jwks.keys.filter(
    (key) => key.kty === "RSA" && (kid === undefined || key.kid === undefined || key.kid === kid),
  );
  if (candidates.length === 0) throw new Error("no matching JWK for token kid");

  for (const jwk of candidates) {
    const key = jwkToKeyObject(jwk);
    if (verifyRs256(key, jwt)) return jwt;
  }
  throw new Error("JWT signature does not verify against any JWK");
}

function verifyRs256(key: ReturnType<typeof createPublicKey>, jwt: JwtParts): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(jwt.signingInput);
  verifier.end();
  return verifier.verify(key, jwt.signature);
}

function jwkToKeyObject(jwk: Jwk): ReturnType<typeof createPublicKey> {
  if (!jwk.n || !jwk.e) throw new Error("JWK missing RSA parameters");
  return createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
}

/**
 * Verify a PKI token whose x5c leaf is signed by `rootCertificatePem`. The
 * root is mandatory: verifying only the leaf would let any self-signed
 * certificate impersonate the attestation service.
 */
export function verifyPkiToken(token: string, rootCertificatePem: string): JwtParts {
  const jwt = parseJwt(token);
  if (typeof rootCertificatePem !== "string" || rootCertificatePem.trim().length === 0) {
    throw new Error("PKI root certificate is required");
  }
  const x5c = jwt.header["x5c"];
  if (!Array.isArray(x5c) || x5c.length === 0 || typeof x5c[0] !== "string") {
    throw new Error("PKI token missing x5c header");
  }
  const leaf = new X509Certificate(Buffer.from(x5c[0], "base64"));
  const root = new X509Certificate(rootCertificatePem);

  if (!leaf.verify(root.publicKey)) {
    throw new Error("leaf certificate is not signed by the pinned root");
  }

  const now = Date.now();
  if (Date.parse(leaf.validFrom) > now) throw new Error("leaf certificate is not yet valid");
  if (Date.parse(leaf.validTo) < now) throw new Error("leaf certificate has expired");
  if (Date.parse(root.validTo) < now) throw new Error("root certificate has expired");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(jwt.signingInput);
  verifier.end();
  if (!verifier.verify(leaf.publicKey, jwt.signature)) {
    throw new Error("PKI token signature invalid");
  }
  return jwt;
}
