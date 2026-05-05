// Example 2 — Encrypt and decrypt a file with CDR + IPFS.
//
// On-chain inline data is capped (~1KB), so for files the SDK:
//   1. Encrypts the file with a fresh AES key.
//   2. Uploads the AES-encrypted bytes to IPFS (via Helia here).
//   3. Encrypts the AES key under CDR and stores it on-chain.
// Reading reverses the process.
//
// Conditions: same as Example 1 — OwnerWriteCondition contract for write,
// owner EOA for read. Because of the EOA read condition we drop to the
// lower-level allocate/write calls (uploadFile doesn't expose the
// skipConditionValidation flag).
//
// Run: pnpm file  (or npm run file)
// Note: HeliaProvider needs Node 22+.

import { readFile, writeFile } from "node:fs/promises";
import { encodeAbiParameters, toHex } from "viem";
import { HeliaProvider, encryptFile, uuidToLabel } from "@piplabs/cdr-sdk";
import { createHelia } from "helia";
import { unixfs } from "@helia/unixfs";
import { CID } from "multiformats/cid";
import { client, walletClient, ready } from "./client.js";

const OWNER_WRITE_CONDITION = "0x4C9bFC96d7092b590D497A191826C3dA2277c34B";

const INPUT_PATH = "./example.txt";
const OUTPUT_PATH = "./example.decrypted.txt";

async function main() {
  // Step 1. Init WASM crypto.
  await ready();

  // Step 2. If the demo input file isn't there, drop a placeholder so the example runs.
  await writeFile(INPUT_PATH, "this is a confidential file payload\n", { flag: "a+" });
  const sourceFile = await readFile(INPUT_PATH);
  console.log(`Source: ${INPUT_PATH} (${sourceFile.length} bytes)`);

  const owner = walletClient.account.address;
  const writeConditionData = encodeAbiParameters([{ type: "address" }], [owner]);

  // Step 3. Spin up an IPFS node via Helia and wrap it with the SDK's storage adapter.
  console.log("Starting Helia IPFS node...");
  const helia = await createHelia();
  const storage = new HeliaProvider({
    helia,
    unixfs: unixfs(helia),
    CID: (s: string) => CID.parse(s),
  });

  // Step 4. AES-encrypt the file body locally.
  const { ciphertext: encryptedFile, key: aesKey } = encryptFile(new Uint8Array(sourceFile));

  // Step 5. Push the encrypted bytes to IPFS. The CID is what the consumer
  // will fetch later; only the AES key is gated by CDR.
  console.log("Uploading encrypted file to IPFS...");
  const cid = await storage.upload(encryptedFile, { pin: true });
  console.log(`IPFS CID: ${cid}`);

  // Step 6. Allocate a CDR vault. Same EOA-read-condition trick as in Example 1.
  console.log("Allocating CDR vault...");
  const { uuid } = await client.uploader.allocate({
    updatable: false,
    writeConditionAddr: OWNER_WRITE_CONDITION,
    writeConditionData,
    readConditionAddr: owner,
    readConditionData: "0x",
    skipConditionValidation: true,
  });
  console.log(`Vault uuid: ${uuid}`);

  // Step 7. Build the JSON payload (cid + AES key) that gets stored encrypted
  // in the vault, then TDH2-encrypt it with the UUID-derived label.
  const payload = new TextEncoder().encode(JSON.stringify({ cid, key: toHex(aesKey) }));
  const globalPubKey = await client.observer.getGlobalPubKey();
  const label = uuidToLabel(uuid);
  const ciphertext = await client.uploader.encryptDataKey({
    dataKey: payload,
    globalPubKey,
    label,
  });

  // Step 8. Write the encrypted payload on-chain.
  console.log("Writing encrypted payload on-chain...");
  await client.uploader.write({
    uuid,
    accessAuxData: "0x",
    encryptedData: toHex(ciphertext.raw),
  });

  // Step 9. Round-trip read: pulls ciphertext from IPFS, decrypts the AES key
  // via threshold decryption, then decrypts the file body locally.
  console.log("\nDownloading and decrypting...");
  const { content, txHash } = await client.consumer.downloadFile({
    uuid,
    accessAuxData: "0x",
    storageProvider: storage,
    timeoutMs: 120_000,
  });
  console.log(`Read tx: ${txHash}`);

  await writeFile(OUTPUT_PATH, Buffer.from(content));
  console.log(`Wrote decrypted file to ${OUTPUT_PATH} (${content.length} bytes)`);

  await helia.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
