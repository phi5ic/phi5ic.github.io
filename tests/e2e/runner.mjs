#!/usr/bin/env node

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startMockGitHubServer } from './helpers/mock-github.mjs';
import { startAstroServer } from './helpers/server.mjs';

// Enforce Node.js 22+
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < 22) {
  console.error(`❌ Error: Node.js version 22 or higher is required. Detected: ${process.version}`);
  process.exit(1);
}

// Parse CLI flags
const args = process.argv.slice(2);
const tierArg = args.find((a) => a.startsWith('--tier='));
const selectedTier = tierArg ? tierArg.split('=')[1] : 'all';
const fileArg = args.find((a) => a.startsWith('--file='));
const filterFile = fileArg ? fileArg.split('=')[1] : null;
const noBuild = args.includes('--no-build');
const verbose = args.includes('--verbose');

console.log('================================================================');
console.log(' 🚀 phi5ic Blog E2E Test Suite Orchestrator');
console.log(` ⚙️  Node Runtime: ${process.version} | Target Tier: ${selectedTier}`);
console.log('================================================================\n');

// Discover test files
function resolveTestFiles() {
  const baseDir = path.resolve('tests/e2e');
  const tiers = [
    { id: '1', dir: 'tier1-feature-coverage' },
    { id: '2', dir: 'tier2-boundary-corner' },
    { id: '3', dir: 'tier3-cross-feature' },
    { id: '4', dir: 'tier4-application-scenarios' },
  ];

  let targetTiers = tiers;
  if (selectedTier !== 'all') {
    targetTiers = tiers.filter((t) => t.id === selectedTier || t.dir.includes(selectedTier));
  }

  const files = [];
  for (const t of targetTiers) {
    const fullDir = path.join(baseDir, t.dir);
    if (fs.existsSync(fullDir)) {
      const entries = fs.readdirSync(fullDir)
        .filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.js'))
        .map((f) => path.join('tests/e2e', t.dir, f));
      files.push(...entries);
    }
  }

  if (filterFile) {
    return files.filter((f) => f.includes(filterFile));
  }

  return files.sort();
}

async function main() {
  let mockServer = null;
  let astroServer = null;
  let cleanExited = false;

  const cleanup = async () => {
    if (cleanExited) return;
    cleanExited = true;
    console.log('\n🧹 Tearing down test servers...');
    if (astroServer) {
      try {
        await astroServer.stop();
        console.log('✓ Astro test server terminated');
      } catch (e) {
        // ignore
      }
    }
    if (mockServer) {
      try {
        await mockServer.close();
        console.log('✓ Mock GitHub server terminated');
      } catch (e) {
        // ignore
      }
    }
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(143);
  });

  try {
    // 1. Build check
    if (!noBuild) {
      console.log('📦 Verifying / compiling Astro build...');
      try {
        execSync('npm run build', { stdio: verbose ? 'inherit' : 'pipe' });
        console.log('✓ Build compiled successfully\n');
      } catch (buildErr) {
        console.error('❌ Build failed before test execution:');
        if (buildErr.stdout) console.error(buildErr.stdout.toString());
        if (buildErr.stderr) console.error(buildErr.stderr.toString());
        process.exit(1);
      }
    }

    // 2. Start Mock GitHub Server
    console.log('🌐 Starting stateful Mock GitHub server...');
    mockServer = await startMockGitHubServer(0);
    console.log(`✓ Mock GitHub server listening at ${mockServer.url}`);

    // 3. Start Astro Server
    console.log('⚡ Starting Astro server under test...');
    astroServer = await startAstroServer({
      mockGitHubUrl: mockServer.url,
      verbose,
    });
    console.log(`✓ Astro server ready at ${astroServer.baseUrl}\n`);

    // 4. Resolve test files
    const testFiles = resolveTestFiles();
    if (testFiles.length === 0) {
      console.warn('⚠️ No test files matched criteria.');
      await cleanup();
      process.exit(0);
    }

    console.log(`📋 Running ${testFiles.length} test suite(s):`);
    for (const f of testFiles) {
      console.log(`   - ${f}`);
    }
    console.log('----------------------------------------------------------------\n');

    // 5. Execute tests via native node:test runner
    const testRunner = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', ...testFiles],
      {
        env: {
          ...process.env,
          E2E_BASE_URL: astroServer.baseUrl,
          MOCK_GITHUB_URL: mockServer.url,
        },
        stdio: 'inherit',
      }
    );

    testRunner.on('close', async (code) => {
      await cleanup();
      if (code === 0) {
        console.log('\n================================================================');
        console.log(' ✅ ALL E2E TEST SUITES PASSED SUCCESSFULLY');
        console.log('================================================================\n');
        process.exit(0);
      } else {
        console.error('\n================================================================');
        console.error(` ❌ E2E TEST SUITE RUN FAILED (Exit Code: ${code})`);
        console.error('================================================================\n');
        process.exit(code ?? 1);
      }
    });
  } catch (err) {
    console.error('❌ Orchestrator fatal error:', err);
    await cleanup();
    process.exit(1);
  }
}

main();
