// Example 3 — License-gated CDR vault.
//
// The vault is encrypted so that anyone holding a valid Story license token for
// a given IP asset can decrypt it. Write access stays with the IP owner.
//
// Flow:
//   1. Owner uploads the secret with readConditionAddr = LicenseReadCondition,
//      readConditionData = (licenseTokenContract, ipId).
//   2. A reader mints a license token for that IP.
//   3. Reader calls accessCDR and passes the licenseTokenId as accessAuxData.
//
// Run: pnpm license  (or npm run license)
// Required env: IP_ID, LICENSE_TERMS_ID (and a funded wallet).

import { encodeAbiParameters, parseEther } from "viem";
import { StoryClient } from "@story-protocol/core-sdk";
import { http } from "viem";
import { client, account, walletClient, ready } from "./client.js";

// Aeneid condition + token addresses.
const OWNER_WRITE_CONDITION = "0x4C9bFC96d7092b590D497A191826C3dA2277c34B";
const LICENSE_READ_CONDITION = "0xC0640AD4CF2CaA9914C8e5C44234359a9102f7a3";
const LICENSE_TOKEN = "0xFe3838BFb30B34170F00030B52eA4893d8aAC6bC";
const ROYALTY_MODULE = "0xD2f60c40fEbccf6311f8B47c4f2Ec6b040400086";

async function main() {
  await ready();

  const ipId = process.env.IP_ID as `0x${string}` | undefined;
  const licenseTermsId = process.env.LICENSE_TERMS_ID;
  if (!ipId || !licenseTermsId) {
    throw new Error("Set IP_ID and LICENSE_TERMS_ID in .env");
  }

  const owner = walletClient.account.address;

  // ── Step 1. Upload the gated secret. ─────────────────────────────────────
  // Write condition: OwnerWriteCondition contract bound to our address.
  // Read condition: LicenseReadCondition bound to (LICENSE_TOKEN, ipId) — any
  // wallet holding a valid license token for `ipId` can read.
  const writeCondData = encodeAbiParameters([{ type: "address" }], [owner]);
  const readCondData = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [LICENSE_TOKEN, ipId],
  );

  const globalPubKey = await client.observer.getGlobalPubKey();
  const dataKey = new TextEncoder().encode(
    "licensed IP payload — only paying readers see this",
  );

  console.log("Uploading license-gated vault...");
  const { uuid } = await client.uploader.uploadCDR({
    dataKey,
    globalPubKey,
    updatable: false,
    writeConditionAddr: OWNER_WRITE_CONDITION,
    writeConditionData: writeCondData,
    readConditionAddr: LICENSE_READ_CONDITION,
    readConditionData: readCondData,
    accessAuxData: "0x",
  });
  console.log(`Vault uuid: ${uuid}`);

  // ── Step 2. Mint a license token to use as the reader's key. ─────────────
  // In a real app the reader would do this from a different wallet. Here we
  // mint with the same wallet to keep the demo single-process.

  // 2a. Wrap 1 IP → 1 WIP so we can pay the minting fee in WIP.
  console.log("Wrapping 1 IP to WIP...");
  const storyClient = StoryClient.newClient({
    transport: http(process.env.RPC_URL ?? "https://aeneid.storyrpc.io"),
    account,
    chainId: "aeneid",
  });
  await storyClient.wipClient.deposit({
    amount: parseEther("1"),
  });

  // 2b. Approve the RoyaltyModule to spend WIP for the mint.
  console.log("Approving RoyaltyModule to spend WIP...");
  await storyClient.wipClient.approve({
    spender: ROYALTY_MODULE,
    amount: parseEther("1"),
  });

  // 2c. Mint the license token via the Story core SDK.
  console.log("Minting license token...");
  const mintResult = await storyClient.license.mintLicenseTokens({
    licensorIpId: ipId,
    licenseTermsId: BigInt(licenseTermsId),
    amount: 1,
  });
  const licenseTokenId = mintResult.licenseTokenIds![0];
  console.log(`License token id: ${licenseTokenId}`);

  // ── Step 3. Read the gated content. ──────────────────────────────────────
  // accessAuxData carries the license token id(s) we want to use to satisfy
  // the read condition.
  const accessAuxData = encodeAbiParameters(
    [{ type: "uint256[]" }],
    [[BigInt(licenseTokenId)]],
  );

  console.log("\nDecrypting with license token...");
  const { dataKey: recovered } = await client.consumer.accessCDR({
    uuid,
    accessAuxData,
    timeoutMs: 120_000,
  });
  console.log(`Decrypted: ${new TextDecoder().decode(recovered)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
