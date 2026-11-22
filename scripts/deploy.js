import { execSync } from 'child_process';
import { existsSync, rmSync, cpSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

const worktreeDir = path.resolve('.gh-pages-deploy');
const clientDistDir = path.resolve('dist/client');

try {
  console.log('🚀 Building Astro project...');
  run('npm run build');

  // Pre-check: ensure dist/client directory exists after build
  if (!existsSync(clientDistDir)) {
    throw new Error(
      `Build output directory "${clientDistDir}" does not exist. Ensure Astro build succeeded with @astrojs/node adapter.`
    );
  }

  if (existsSync(worktreeDir)) {
    rmSync(worktreeDir, { recursive: true, force: true });
    try {
      run('git worktree prune');
    } catch (e) {
      // ignore
    }
  }

  console.log('🌿 Preparing gh-pages branch...');
  // Check if gh-pages branch exists locally or on remote
  let branchExists = false;
  try {
    execSync('git rev-parse --verify origin/gh-pages', { stdio: 'ignore' });
    branchExists = true;
  } catch (e) {
    // Branch does not exist on remote
  }

  if (branchExists) {
    run(`git worktree add -B gh-pages "${worktreeDir}" origin/gh-pages`);
  } else {
    run(`git worktree add --orphan -B gh-pages "${worktreeDir}"`);
  }

  console.log('📦 Syncing dist/client files to gh-pages...');
  // Clear worktree directory contents except .git worktree metadata
  const existingFiles = readdirSync(worktreeDir);
  for (const file of existingFiles) {
    if (file !== '.git') {
      rmSync(path.join(worktreeDir, file), { recursive: true, force: true });
    }
  }

  // Copy dist/client contents to worktree root (preserving dotfiles)
  cpSync(clientDistDir, worktreeDir, { recursive: true });

  // Ensure .nojekyll is present at worktree root
  const nojekyllPath = path.join(worktreeDir, '.nojekyll');
  if (!existsSync(nojekyllPath)) {
    const srcNojekyll = path.join(clientDistDir, '.nojekyll');
    if (existsSync(srcNojekyll)) {
      cpSync(srcNojekyll, nojekyllPath);
    } else {
      writeFileSync(nojekyllPath, '');
    }
  }

  // Security assertions: ensure no server code, entrypoints, or secrets are deployed
  console.log('🔒 Running security assertions on worktree...');
  const forbiddenNames = ['server', 'dist', 'entry.mjs'];
  for (const forbidden of forbiddenNames) {
    if (existsSync(path.join(worktreeDir, forbidden))) {
      throw new Error(`Security assertion failed: forbidden artifact "${forbidden}" detected in worktree root!`);
    }
  }

  const worktreeEntries = readdirSync(worktreeDir);
  for (const entry of worktreeEntries) {
    if (entry.startsWith('.env')) {
      throw new Error(`Security assertion failed: environment secret file "${entry}" detected in worktree root!`);
    }
  }

  console.log('💾 Committing and pushing to gh-pages...');
  run('git add -A', { cwd: worktreeDir });

  try {
    run('git commit -m "Deploy Astro site to gh-pages [skip ci]"', { cwd: worktreeDir });
  } catch (e) {
    console.log('No changes to commit in gh-pages.');
  }

  run('git push -u origin gh-pages', { cwd: worktreeDir });

  console.log('✅ Successfully deployed to gh-pages!');
} catch (error) {
  console.error('❌ Deployment failed:', error.message);
  process.exitCode = 1;
} finally {
  console.log('🧹 Cleaning up worktree...');
  if (existsSync(worktreeDir)) {
    try {
      run(`git worktree remove --force "${worktreeDir}"`);
    } catch (cleanupError) {
      console.warn('⚠️ git worktree remove failed, forcing removal:', cleanupError.message);
      rmSync(worktreeDir, { recursive: true, force: true });
      try {
        run('git worktree prune');
      } catch (e) {
        // ignore
      }
    }
  }
}
