// Example 1 — Encrypt and decrypt a small text secret with CDR.
//
// What you'll see:
//   - Allocate a vault on-chain
//   - Encrypt locally with the validator-network DKG public key
//   - Write the ciphertext on-chain
//   - Read it back: only the wallet that owns the vault can decrypt
//
// Conditions:
//   - Write: OwnerWriteCondition contract (gates writes to one address).
//   - Read:  the owner's EOA. The CDR precompile treats an EOA condition as
//            "only this exact address can perform the action", so no
//            condition contract is needed for the read side.
//
// Run: pnpm text  (or npm run text)

import { encodeAbiParameters, toHex } from "viem";
import { uuidToLabel } from "@piplabs/cdr-sdk";
import { client, walletClient, ready } from "./client.js";

// OwnerWriteCondition deployed on Aeneid.
const OWNER_WRITE_CONDITION = "0x4C9bFC96d7092b590D497A191826C3dA2277c34B";

async function main() {
  // Step 1. Initialize the WASM crypto module.
  await ready();

  const owner = walletClient.account.address;
  console.log(`Owner wallet: ${owner}`);

  // Step 2. Encode the write condition payload — just the owner address.
  const writeConditionData = encodeAbiParameters(
    [{ type: "address" }],
    [owner],
  );

  // Step 3. Fetch the DKG public key. Encryption is done locally with this key.
  const globalPubKey = await client.observer.getGlobalPubKey();

  // Step 4. Allocate the vault. We pass `skipConditionValidation: true` because
  // our read condition is an EOA, which doesn't implement the condition
  // contract interface — the SDK's preflight check would reject it. The CDR
  // precompile itself accepts EOAs and gates the action to that exact caller.
  console.log("Allocating vault...");
  const { uuid, txHash: allocateTx } = await client.uploader.allocate({
    updatable: false,
    writeConditionAddr: OWNER_WRITE_CONDITION,
    writeConditionData,
    readConditionAddr: owner,
    readConditionData: "0x",
    skipConditionValidation: true,
  });
  console.log(`Vault uuid:  ${uuid}`);
  console.log(`Allocate tx: ${allocateTx}`);

  // Step 5. Encrypt the secret locally with TDH2. The label is derived from
  // the UUID, which binds the ciphertext to this specific vault.
  const secret = "the launch code is hunter2";
  const dataKey = new TextEncoder().encode(secret);
  const label = uuidToLabel(uuid);
  const ciphertext = await client.uploader.encryptDataKey({
    dataKey,
    globalPubKey,
    label,
  });

  // Step 6. Write the ciphertext on-chain.
  console.log("Writing ciphertext...");
  const { txHash: writeTx } = await client.uploader.write({
    uuid,
    accessAuxData: "0x",
    encryptedData: toHex(ciphertext.raw),
  });
  console.log(`Write tx:    ${writeTx}`);

  // Step 7. accessCDR submits a read request, collects partial decryptions
  // from validators, and combines them locally into the original plaintext.
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
