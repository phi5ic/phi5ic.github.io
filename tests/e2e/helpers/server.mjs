import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Finds an available dynamic/ephemeral TCP port
 * @returns {Promise<number>}
 */
export async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Polls an HTTP endpoint until it answers or times out
 * @param {string} url
 * @param {number} timeoutMs
 */
export async function waitForServer(url, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status >= 200 && res.status < 500) {
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for server at ${url} after ${timeoutMs}ms`);
}

/**
 * Standalone Astro Server Manager with atomic ephemeral port allocation and retry
 * @param {object} options
 */
export async function startAstroServer(options = {}) {
  const maxRetries = options.retries ?? 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await spawnAstroServerAttempt(options);
    } catch (err) {
      lastError = err;
      if (options.verbose) {
        console.warn(`[startAstroServer] Attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying...`);
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }

  throw new Error(`Failed to start Astro server after ${maxRetries} attempts: ${lastError?.message}`, { cause: lastError });
}

async function spawnAstroServerAttempt(options = {}) {
  const host = options.host || '127.0.0.1';
  const requestedPort = options.port ?? 0;
  const mockUrl = options.mockGitHubUrl || 'http://127.0.0.1:43211';
  const sessionSecret = options.sessionSecret || 'test-session-secret-32-chars-long-e2e-suite';

  const env = {
    ...process.env,
    PORT: String(requestedPort),
    HOST: host,
    NODE_ENV: 'test',
    SESSION_SECRET: sessionSecret,
    GITHUB_CLIENT_ID: 'mock_github_client_id',
    GITHUB_CLIENT_SECRET: 'mock_github_client_secret',
    GITHUB_ALLOWED_USER: 'phi5ic',
    ALLOWED_USER: 'phi5ic',
    GITHUB_API_URL: mockUrl,
    GITHUB_OAUTH_URL: mockUrl,
    GITHUB_API_BASE_URL: mockUrl,
    GITHUB_OAUTH_BASE_URL: mockUrl,
    GITHUB_REPO_OWNER: 'phi5ic',
    GITHUB_REPO_NAME: 'phi5ic.github.io',
    GITHUB_REPO_BRANCH: 'main',
    ...options.env,
  };

  const serverEntryPath = path.resolve('dist/server/entry.mjs');
  let cmd;
  let args;

  if (fs.existsSync(serverEntryPath)) {
    cmd = process.execPath;
    args = [serverEntryPath];
  } else {
    cmd = 'npx';
    args = ['astro', 'preview', '--port', String(requestedPort), '--host', host];
  }

  const child = spawn(cmd, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    } catch (e) {
      // ignore
    }
  };

  let port = requestedPort;
  if (port === 0) {
    try {
      port = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for server listening port output'));
        }, 10000);

        const onData = (chunk) => {
          const str = chunk.toString('utf8');
          if (options.verbose) process.stdout.write(`[astro:out] ${str}`);
          const match = str.match(/https?:\/\/(?:[a-zA-Z0-9.-]+):(\d+)/i);
          if (match) {
            clearTimeout(timeout);
            cleanupListeners();
            resolve(parseInt(match[1], 10));
          }
        };

        const onErr = (chunk) => {
          const str = chunk.toString('utf8');
          if (options.verbose) process.stderr.write(`[astro:err] ${str}`);
          if (str.includes('EADDRINUSE')) {
            clearTimeout(timeout);
            cleanupListeners();
            reject(new Error(`Port conflict: ${str.trim()}`));
          }
        };

        const onExit = (code) => {
          clearTimeout(timeout);
          cleanupListeners();
          reject(new Error(`Server process exited prematurely with code ${code}`));
        };

        const cleanupListeners = () => {
          child.stdout?.removeListener('data', onData);
          child.stderr?.removeListener('data', onErr);
          child.removeListener('exit', onExit);
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onErr);
        child.once('exit', onExit);
      });
    } catch (portErr) {
      await stop();
      throw portErr;
    }
  }

  if (options.verbose && !options.silent) {
    child.stdout?.on('data', (d) => process.stdout.write(`[astro:out] ${d}`));
    child.stderr?.on('data', (d) => process.stderr.write(`[astro:err] ${d}`));
  }

  const baseUrl = `http://${host}:${port}`;

  try {
    await waitForServer(`${baseUrl}/`, 15000);
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    process: child,
    port,
    baseUrl,
    stop,
  };
}
