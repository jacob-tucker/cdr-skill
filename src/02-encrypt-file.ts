// Example 2 — Encrypt and decrypt a file with CDR + IPFS.
//
// On-chain inline data is capped (~1KB), so for files the SDK:
//   1. Encrypts the file with a fresh AES key.
//   2. Uploads the AES-encrypted bytes to IPFS (via Helia here).
//   3. Encrypts the AES key under CDR and stores it on-chain.
// Reading reverses the process.
//
// Run: pnpm file  (or npm run file)
// Note: HeliaProvider needs Node 22+.

import { readFile, writeFile } from "node:fs/promises";
import { encodeAbiParameters } from "viem";
import { HeliaProvider } from "@piplabs/cdr-sdk";
import { createHelia } from "helia";
import { unixfs } from "@helia/unixfs";
import { CID } from "multiformats/cid";
import { client, walletClient, ready } from "./client.js";

const OWNER_CONDITION = "0x4C9bFC96d7092b590D497A191826C3dA2277c34B";

const INPUT_PATH = "./example.txt";
const OUTPUT_PATH = "./example.decrypted.txt";

async function main() {
  // Step 1. Init WASM crypto.
  await ready();

  // Step 2. If the demo input file isn't there, drop a placeholder so the example runs.
  await writeFile(INPUT_PATH, "this is a confidential file payload\n", { flag: "a+" });
  const sourceFile = await readFile(INPUT_PATH);
  console.log(`Source: ${INPUT_PATH} (${sourceFile.length} bytes)`);

  // Step 3. Build access-control data — owner-only read & write.
  const owner = walletClient.account.address;
  const ownerConditionData = encodeAbiParameters([{ type: "address" }], [owner]);

  // Step 4. Spin up an IPFS node via Helia and wrap it with the SDK's storage adapter.
  console.log("Starting Helia IPFS node...");
  const helia = await createHelia();
  const storage = new HeliaProvider({
    helia,
    unixfs: unixfs(helia),
    CID: (s: string) => CID.parse(s),
  });

  // Step 5. Fetch DKG public key.
  const globalPubKey = await client.observer.getGlobalPubKey();

  // Step 6. Encrypt + upload to IPFS + write key vault on-chain.
  console.log("Encrypting and uploading to IPFS...");
  const { uuid, cid } = await client.uploader.uploadFile({
    content: new Uint8Array(sourceFile),
    storageProvider: storage,
    globalPubKey,
    updatable: false,
    writeConditionAddr: OWNER_CONDITION,
    readConditionAddr: OWNER_CONDITION,
    writeConditionData: ownerConditionData,
    readConditionData: ownerConditionData,
    accessAuxData: "0x",
  });
  console.log(`Vault uuid: ${uuid}`);
  console.log(`IPFS CID:   ${cid}`);

  // Step 7. Read it back: pulls ciphertext from IPFS, decrypts the AES key via
  // threshold decryption, then decrypts the file body locally.
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
