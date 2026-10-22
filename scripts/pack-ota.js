// scripts/pack-ota.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const versionArg = process.argv[2];
let targetVersion = versionArg;

if (!targetVersion) {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
    targetVersion = pkg.version || '1.0.1';
}

console.log(`📦 Packaging OTA update v${targetVersion}...`);

// 1. Build latest web assets
console.log('⚡ Running Vite build...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

// 2. Prepare output directory
const outDir = path.join(rootDir, 'ota-release');
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

const zipPath = path.join(outDir, 'dist.zip');
if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
}

// 3. Compress dist directory into dist.zip (POSIX forward-slash format compatible with Android)
console.log('🗜️ Compressing dist folder into dist.zip (standard POSIX format)...');
const distDir = path.join(rootDir, 'dist');
execSync(`tar -a -cf "${zipPath}" *`, { cwd: distDir, stdio: 'inherit', shell: true });

// Verify zip entries do not contain Windows backslashes
const checkOutput = execSync(`tar -tf "${zipPath}"`, { encoding: 'utf-8' });
if (checkOutput.includes('\\')) {
    console.error('❌ WARNING: Archive contains Windows backslashes which will fail on Android!');
} else {
    console.log('✅ Archive verified: All paths formatted with POSIX forward slashes.');
}

// Calculate SHA-256 checksum required by CapacitorUpdater
const fileBuffer = fs.readFileSync(zipPath);
const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
console.log(`🔑 SHA-256 Checksum: ${checksum}`);

// Create versioned zip to completely bypass any Fastly/CDN edge caching of the zip file
const versionedZipPath = path.join(outDir, `dist-v${targetVersion}.zip`);
fs.copyFileSync(zipPath, versionedZipPath);

// 4. Generate version.json and update checksums.json
const checksumsPath = path.join(outDir, 'checksums.json');
let checksumsMap = {};
if (fs.existsSync(checksumsPath)) {
    try {
        checksumsMap = JSON.parse(fs.readFileSync(checksumsPath, 'utf-8'));
    } catch (_) {}
}
checksumsMap[targetVersion] = checksum;
fs.writeFileSync(checksumsPath, JSON.stringify(checksumsMap, null, 2), 'utf-8');

const manifest = {
    version: targetVersion,
    url: `https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/dist-v${targetVersion}.zip`,
    fallbackUrl: "https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/dist.zip",
    checksum: checksum,
    updatedAt: new Date().toISOString(),
    notes: process.argv[3] || "Bug fixes, performance improvements, and Messenger integration enhancements"
};

const manifestPath = path.join(outDir, 'version.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

const zipStats = fs.statSync(zipPath);
console.log(`\n✅ OTA Package successfully created!`);
console.log(`📁 Files in ota-release/:`);
console.log(`   - dist.zip (${(zipStats.size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`   - dist-v${targetVersion}.zip`);
console.log(`   - version.json (v${targetVersion})`);
console.log(`   - checksums.json (updated)`);
console.log(`   - checksum: ${checksum}`);
console.log(`\n🚀 NEXT STEP:`);
console.log(`Push files to https://github.com/mielglitx/LokalexOTAUpdate:`);
console.log(`   cd ota-release`);
console.log(`   git add dist.zip dist-v${targetVersion}.zip version.json checksums.json`);
console.log(`   git commit -m "Release v${targetVersion}"`);
console.log(`   git push origin main`);

