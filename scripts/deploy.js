import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import path from 'path';

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

try {
  console.log('🚀 Building Astro project...');
  run('npm run build');

  const worktreeDir = path.resolve('.gh-pages-deploy');
  if (existsSync(worktreeDir)) {
    rmSync(worktreeDir, { recursive: true, force: true });
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

  console.log('📦 Syncing dist files to gh-pages...');
  run(`rm -rf "${worktreeDir}"/*`);
  run(`cp -r dist/* "${worktreeDir}"/`);
  run(`cp dist/.nojekyll "${worktreeDir}"/`);

  console.log('💾 Committing and pushing to gh-pages...');
  run('git add -A', { cwd: worktreeDir });
  
  try {
    run('git commit -m "Deploy Astro site to gh-pages [skip ci]"', { cwd: worktreeDir });
  } catch (e) {
    console.log('No changes to commit in gh-pages.');
  }

  run('git push -u origin gh-pages', { cwd: worktreeDir });

  console.log('🧹 Cleaning up worktree...');
  run(`git worktree remove --force "${worktreeDir}"`);

  console.log('✅ Successfully deployed to gh-pages!');
} catch (error) {
  console.error('❌ Deployment failed:', error.message);
  process.exit(1);
}
