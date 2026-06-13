#!/usr/bin/env node
// Build-time step (run by `predist`): XOR-scramble assets/ss_dev.json into assets/ss_dev.dat
// so the shipped AppImage contains no plaintext dev credentials — the same idea ES-DE uses.
// The key here MUST match SS_DEV_KEY in main.js. This is obfuscation, not encryption; it only
// keeps the credentials out of `strings`/secret-scanner reach. If ss_dev.json is absent we skip
// quietly so builds on machines without the credentials still succeed (scraping just stays off).
const fs   = require('fs');
const path = require('path');

const SS_DEV_KEY = 'EmuLatte::cafeneurotico::ss-dev::xor::v1';
const jsonPath = path.join(__dirname, '..', 'assets', 'ss_dev.json');
const datPath  = path.join(__dirname, '..', 'assets', 'ss_dev.dat');

function xor(buf) {
    const out = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ SS_DEV_KEY.charCodeAt(i % SS_DEV_KEY.length);
    return out;
}

if (!fs.existsSync(jsonPath)) {
    console.warn('scramble-ssdev: assets/ss_dev.json not found — skipping (build will ship without dev credentials).');
    process.exit(0);
}

// Validate it parses before scrambling, so a typo is caught at build time rather than at runtime.
const raw = fs.readFileSync(jsonPath, 'utf8');
JSON.parse(raw);
fs.writeFileSync(datPath, xor(Buffer.from(raw, 'utf8')).toString('base64'));
console.log('scramble-ssdev: wrote assets/ss_dev.dat');
