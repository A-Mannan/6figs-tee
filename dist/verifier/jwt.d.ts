export interface JwtParts {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    signingInput: string;
    signature: Uint8Array;
}
export declare function parseJwt(token: string): JwtParts;
export interface Jwk {
    kty: string;
    kid?: string;
    n?: string;
    e?: string;
    x5c?: string[];
    alg?: string;
}
/** Verify an RS256 JWT with a JWKS document (Google OIDC flow). */
export declare function verifyRs256WithJwks(token: string, jwks: {
    keys: Jwk[];
}): JwtParts;
/**
 * Verify a PKI token whose x5c leaf is signed by `rootCertificatePem`. The
 * root is mandatory: verifying only the leaf would let any self-signed
 * certificate impersonate the attestation service.
 */
export declare function verifyPkiToken(token: string, rootCertificatePem: string): JwtParts;
