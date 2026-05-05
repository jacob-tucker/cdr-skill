// Shared CDR client setup used by every example script.
//
// Step 1. Load env vars (private key + RPC URL).
// Step 2. Build a viem publicClient (reads) + walletClient (writes).
// Step 3. Wrap them in a CDRClient pointed at Aeneid testnet.
// Step 4. Initialize the WASM crypto module before any encrypt/decrypt call.

import "dotenv/config";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CDRClient, initWasm } from "@piplabs/cdr-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://aeneid.storyrpc.io";
const PK = process.env.WALLET_PRIVATE_KEY;

if (!PK) {
  throw new Error("WALLET_PRIVATE_KEY missing — copy .env.example to .env and fill it in.");
}

export const account = privateKeyToAccount(`0x${PK.replace(/^0x/, "")}`);

export const publicClient = createPublicClient({
  transport: http(RPC_URL),
});

export const walletClient = createWalletClient({
  account,
  transport: http(RPC_URL),
});

export const client = new CDRClient({
  network: "testnet",
  publicClient,
  walletClient,
});

// Must be awaited once before any TDH2 encrypt/decrypt operation.
export async function ready() {
  await initWasm();
}
