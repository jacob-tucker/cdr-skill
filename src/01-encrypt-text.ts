// Example 1 — Encrypt and decrypt a small text secret with CDR.
//
// What you'll see:
//   - Allocate a vault on-chain
//   - Encrypt locally with the validator-network DKG public key
//   - Write the ciphertext on-chain
//   - Read it back: only the wallet that owns the vault can decrypt
//
// Run: pnpm text  (or npm run text)

import { encodeAbiParameters } from "viem";
import { client, walletClient, ready } from "./client.js";

// OwnerWriteCondition / OwnerReadCondition contract on Aeneid.
// Both write and read are gated to a single wallet address.
const OWNER_CONDITION = "0x4C9bFC96d7092b590D497A191826C3dA2277c34B";

async function main() {
  // Step 1. Initialize the WASM crypto module.
  await ready();

  const owner = walletClient.account.address;
  console.log(`Owner wallet: ${owner}`);

  // Step 2. Encode the access-control payload. For "owner only" it's just an address.
  const ownerConditionData = encodeAbiParameters([{ type: "address" }], [owner]);

  // Step 3. Fetch the DKG public key. Encryption is done locally with this key.
  const globalPubKey = await client.observer.getGlobalPubKey();

  // Step 4. Encode our secret text as bytes (max ~1024 bytes on Aeneid for inline data).
  const secret = "the launch code is hunter2";
  const dataKey = new TextEncoder().encode(secret);

  // Step 5. uploadCDR does the full flow: allocate vault + encrypt + write ciphertext.
  console.log("Encrypting and uploading...");
  const { uuid, txHashes } = await client.uploader.uploadCDR({
    dataKey,
    globalPubKey,
    updatable: false,
    writeConditionAddr: OWNER_CONDITION,
    readConditionAddr: OWNER_CONDITION,
    writeConditionData: ownerConditionData,
    readConditionData: ownerConditionData,
    accessAuxData: "0x",
  });
  console.log(`Vault uuid:  ${uuid}`);
  console.log(`Allocate tx: ${txHashes.allocate}`);
  console.log(`Write tx:    ${txHashes.write}`);

  // Step 6. accessCDR submits a read request, collects partial decryptions from
  // validators, and combines them locally into the original plaintext.
  console.log("\nRequesting decryption...");
  const { dataKey: recovered, txHash } = await client.consumer.accessCDR({
    uuid,
    accessAuxData: "0x",
    timeoutMs: 120_000,
  });

  console.log(`Read tx:     ${txHash}`);
  console.log(`Decrypted:   ${new TextDecoder().decode(recovered)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
