/**
 * SuperTextSwap Extension Build Script
 *
 * Steps:
 *  1. Clean dist/
 *  2. Walk source tree — obfuscate .js, minify .json, copy everything else
 *  3. Pack dist/ into a versioned .zip  (for Chrome Web Store)
 *  4. Pack dist/ into a versioned .crx  (signed, for direct distribution)
 *     - key.pem is generated on first run; reuse it to keep the extension ID stable
 *
 * Usage:
 *   npm install      (first time only)
 *   npm run build
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const archiver = require("archiver");
const ChromeExtension = require("crx");
const JavaScriptObfuscator = require("javascript-obfuscator");

const pkg = require("./package.json");
const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const ZIP_NAME = `text-swap-v${pkg.version}.zip`;
const CRX_NAME = `text-swap-v${pkg.version}.crx`;
const KEY_FILE = path.join(ROOT, "key.pem");

// ── Whitelist: only these entries are included in dist ─
// Using a whitelist avoids accidentally packing docs, .venv,
// .github, README files, or any other project-level file.
const INCLUDE = ["manifest.json", "src", "icons", "_locales", "LICENSE"];

// ── Obfuscation settings ────────────────────────────────
// renameGlobals must stay false — chrome.* APIs are referenced by name.
// controlFlowFlattening and deadCodeInjection are disabled to keep
// runtime performance acceptable (extension runs on every page load).
const OBFUSCATOR_OPTIONS = {
  compact: true,
  selfDefending: true,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersType: "function",
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  sourceMap: false,
};

// ── Helpers ─────────────────────────────────────────────
function log(tag, msg) {
  console.log(`  [${tag.padEnd(10)}] ${msg}`);
}

// ── Step 1: Clean ──────────────────────────────────────
function clean() {
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  log("clean", "dist/");
}

// ── Step 2: Process source tree ────────────────────────
function processFile(srcPath, destPath) {
  const ext = path.extname(srcPath).toLowerCase();
  const relPath = path.relative(ROOT, srcPath);

  // Never copy signing artifacts into dist
  if (ext === ".pem" || ext === ".crx") return;

  if (ext === ".js") {
    const src = fs.readFileSync(srcPath, "utf8");
    const result = JavaScriptObfuscator.obfuscate(src, OBFUSCATOR_OPTIONS);
    fs.writeFileSync(destPath, result.getObfuscatedCode(), "utf8");
    log("obfuscate", relPath);
  } else if (ext === ".json") {
    const src = fs.readFileSync(srcPath, "utf8");
    fs.writeFileSync(destPath, JSON.stringify(JSON.parse(src)), "utf8");
    log("minify", relPath);
  } else {
    fs.copyFileSync(srcPath, destPath);
    log("copy", relPath);
  }
}

// processDir walks a directory recursively; no filtering needed
// because we only call it on whitelisted paths.
function processDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    entry.isDirectory() ? processDir(src, dest) : processFile(src, dest);
  }
}

// ── Step 3: ZIP ─────────────────────────────────────────
function createZip() {
  const zipPath = path.join(ROOT, ZIP_NAME);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      const kb = (archive.pointer() / 1024).toFixed(1);
      log("zip", `${ZIP_NAME}  (${kb} KB)`);
      resolve();
    });

    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(DIST + "/", false);
    archive.finalize();
  });
}

// ── Step 4: CRX ─────────────────────────────────────────
function ensurePrivateKey() {
  if (fs.existsSync(KEY_FILE)) {
    log("key", "key.pem found — reusing (extension ID stays stable)");
    return fs.readFileSync(KEY_FILE);
  }

  // Generate RSA-2048 private key on first run
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.writeFileSync(KEY_FILE, privateKey, { mode: 0o600 });
  log(
    "keygen",
    "key.pem created — back it up, losing it changes the extension ID!",
  );
  return Buffer.from(privateKey);
}

async function createCrx() {
  const crxPath = path.join(ROOT, CRX_NAME);
  if (fs.existsSync(crxPath)) fs.unlinkSync(crxPath);

  const privateKey = ensurePrivateKey();
  const crx = new ChromeExtension({ privateKey });

  await crx.load(DIST);
  const crxBuffer = await crx.pack();

  fs.writeFileSync(crxPath, crxBuffer);
  const kb = (crxBuffer.length / 1024).toFixed(1);
  log("crx", `${CRX_NAME}  (${kb} KB)`);
}

// ── Entry point ─────────────────────────────────────────
(async () => {
  console.log(`\nBuilding SuperTextSwap v${pkg.version}...\n`);
  try {
    clean();
    console.log("");
    for (const name of INCLUDE) {
      const src = path.join(ROOT, name);
      const dest = path.join(DIST, name);
      if (!fs.existsSync(src)) {
        log("skip", `${name} not found`);
        continue;
      }
      fs.statSync(src).isDirectory()
        ? processDir(src, dest)
        : processFile(src, dest);
    }
    console.log("");
    await createZip();
    await createCrx();
    console.log("\nBuild complete.\n");
  } catch (err) {
    console.error("\nBuild failed:", err.message);
    process.exit(1);
  }
})();
