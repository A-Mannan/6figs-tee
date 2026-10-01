import type { WalletInput } from "../shared/types.ts";
export interface OwnershipContext {
    identityNullifier: string;
    wallets: readonly {
        family: "evm" | "solana";
        address: string;
    }[];
    timestamp: number;
    nonce: string;
}
/**
 * Verify that the supplied signature proves control of the claimed address for
 * this exact identity + nonce. Returns the normalized address on success.
 */
export declare function verifyOwnership(wallet: WalletInput, context: OwnershipContext): {
    ok: true;
    address: string;
} | {
    ok: false;
    reason: string;
};
/** Verify a wallet signature over an arbitrary challenge string. */
export declare function verifyWalletSignature(wallet: WalletInput, message: string): {
    ok: true;
    address: string;
} | {
    ok: false;
    reason: string;
};
