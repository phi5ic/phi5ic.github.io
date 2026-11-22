import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Calculate Git blob SHA1 for given Buffer or string
 * sha1("blob " + length + "\0" + content)
 */
export function computeGitBlobSha(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const header = Buffer.from(`blob ${buf.length}\0`, 'utf8');
  const full = Buffer.concat([header, buf]);
  return crypto.createHash('sha1').update(full).digest('hex');
}

/**
 * Creates and starts a stateful in-memory GitHub Mock Server
 * Mocking GitHub OAuth 2.0 Web Flow and REST Contents API
 */
export async function startMockGitHubServer(port = 0) {
  const revokedTokens = new Set();
  const revocationLog = [];
  const commits = [];
  const repoContents = new Map();
  let chaosConfig = null;

  function seedDefaults() {
    revokedTokens.clear();
    revocationLog.length = 0;
    commits.length = 0;
    repoContents.clear();
    chaosConfig = null;

    // Seed canonical post if it exists on disk
    const canonicalPath = 'src/content/blog/what-I-learned-trying-to-beat-xor.md';
    try {
      if (fs.existsSync(canonicalPath)) {
        const raw = fs.readFileSync(canonicalPath);
        const sha = computeGitBlobSha(raw);
        repoContents.set(canonicalPath, {
          name: 'what-I-learned-trying-to-beat-xor.md',
          path: canonicalPath,
          sha,
          size: raw.length,
          type: 'file',
          content: raw.toString('base64'),
          encoding: 'base64',
        });
      }
    } catch (e) {
      // ignore
    }
  }

  seedDefaults();

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // Collect request body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let body = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        // Parse application/x-www-form-urlencoded
        const params = new URLSearchParams(rawBody);
        body = Object.fromEntries(params.entries());
      }
    }

    // Helper to send JSON
    const sendJson = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // Helper to extract Bearer token
    const extractToken = () => {
      const auth = req.headers.authorization || '';
      const match = auth.match(/(?:Bearer|token)\s+(.+)/i);
      return match ? match[1] : null;
    };

    // -------------------------------------------------------------
    // Mock Inspection / Admin Routes (Control Plane)
    // Processed before chaos to ensure management endpoints are never deadlocked
    // -------------------------------------------------------------
    if (pathname === '/__mock/reset' && method === 'POST') {
      seedDefaults();
      return sendJson(200, { ok: true, message: 'Mock state reset' });
    }

    if (pathname === '/__mock/revocations' && method === 'GET') {
      return sendJson(200, revocationLog);
    }

    if (pathname === '/__mock/commits' && method === 'GET') {
      return sendJson(200, commits);
    }

    if (pathname === '/__mock/contents' && method === 'GET') {
      const all = {};
      for (const [k, v] of repoContents.entries()) {
        all[k] = v;
      }
      return sendJson(200, all);
    }

    if (pathname === '/__mock/chaos' && method === 'POST') {
      chaosConfig = body;
      return sendJson(200, { ok: true, chaos: chaosConfig });
    }

    // Handle Chaos if configured (exempt control plane /__mock/*)
    if (chaosConfig && !pathname.startsWith('/__mock/')) {
      if (chaosConfig.delayMs) {
        await new Promise((r) => setTimeout(r, chaosConfig.delayMs));
      }
      if (chaosConfig.status) {
        const status = chaosConfig.status;
        if (chaosConfig.errorOnce) {
          chaosConfig = null;
        }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Chaos injected error' }));
        return;
      }
    }

    // -------------------------------------------------------------
    // GitHub OAuth: Access Token Exchange
    // POST /login/oauth/access_token
    // -------------------------------------------------------------
    if (pathname === '/login/oauth/access_token' && method === 'POST') {
      const code = body.code || parsedUrl.searchParams.get('code');
      if (!code) {
        return sendJson(400, { error: 'missing_code', error_description: 'Code parameter is required' });
      }

      if (code === 'code_owner') {
        return sendJson(200, {
          access_token: 'token_owner_valid',
          token_type: 'bearer',
          scope: 'repo,read:user',
        });
      }

      if (code === 'code_unauthorized') {
        return sendJson(200, {
          access_token: 'token_unauth_valid',
          token_type: 'bearer',
          scope: 'repo,read:user',
        });
      }

      if (code === 'code_expired' || code === 'code_invalid') {
        return sendJson(200, {
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or has expired.',
        });
      }

      // Default fallback token
      return sendJson(200, {
        access_token: `token_${code}`,
        token_type: 'bearer',
        scope: 'repo,read:user',
      });
    }

    // -------------------------------------------------------------
    // GitHub User Profile: GET /user
    // -------------------------------------------------------------
    if (pathname === '/user' && method === 'GET') {
      const token = extractToken();
      if (!token) {
        return sendJson(401, { message: 'Requires authentication' });
      }

      if (revokedTokens.has(token)) {
        return sendJson(401, { message: 'Bad credentials: token has been revoked' });
      }

      if (token === 'token_owner_valid' || token.includes('owner') || token === 'gho_mock_token') {
        return sendJson(200, {
          login: 'phi5ic',
          id: 190199501,
          name: 'Aravind Anilraj',
          email: 'aravindanilraj0702@gmail.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/190199501',
          html_url: 'https://github.com/phi5ic',
        });
      }

      if (token === 'token_unauth_valid' || token.includes('unauth') || token.includes('attacker')) {
        return sendJson(200, {
          login: 'octocat',
          id: 583231,
          name: 'The Octocat',
          email: 'octocat@github.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/583231',
          html_url: 'https://github.com/octocat',
        });
      }

      // Unknown token
      return sendJson(401, { message: 'Bad credentials' });
    }

    // -------------------------------------------------------------
    // GitHub App Token Revocation: DELETE /applications/:client_id/token
    // or /applications/:client_id/grant
    // -------------------------------------------------------------
    if (pathname.startsWith('/applications/') && (pathname.endsWith('/token') || pathname.endsWith('/grant')) && method === 'DELETE') {
      const token = body.access_token || parsedUrl.searchParams.get('access_token') || extractToken();
      if (token) {
        revokedTokens.add(token);
        revocationLog.push({ token, timestamp: Date.now() });
      }
      res.writeHead(204);
      return res.end();
    }

    // -------------------------------------------------------------
    // GitHub Actions Workflow Status: GET /repos/:owner/:repo/actions/runs
    // -------------------------------------------------------------
    if (pathname.includes('/actions/runs') && method === 'GET') {
      return sendJson(200, {
        total_count: 1,
        workflow_runs: [
          {
            id: 101,
            name: 'Deploy',
            head_branch: 'main',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/phi5ic/phi5ic.github.io/actions/runs/101',
          },
        ],
      });
    }

    // -------------------------------------------------------------
    // GitHub Contents REST API
    // GET & PUT /repos/:owner/:repo/contents/:path
    // -------------------------------------------------------------
    const contentsPrefix = '/repos/';
    if (pathname.startsWith(contentsPrefix) && pathname.includes('/contents/')) {
      const match = pathname.match(new RegExp(`^/repos/([^/]+)/([^/]+)/contents/(.+)$`));
      if (!match) {
        return sendJson(400, { message: 'Invalid contents API URL structure' });
      }
      const [, owner, repo, filePath] = match;
      const normalizedPath = decodeURIComponent(filePath);

      // GET file contents
      if (method === 'GET') {
        const item = repoContents.get(normalizedPath);
        if (!item) {
          return sendJson(404, { message: `Not Found: ${normalizedPath}` });
        }
        return sendJson(200, item);
      }

      // PUT file contents (create or update)
      if (method === 'PUT') {
        const token = extractToken();
        if (!token || revokedTokens.has(token)) {
          return sendJson(401, { message: 'Bad credentials' });
        }

        const { message, content, branch, sha, author, committer } = body;
        if (!content || !message) {
          return sendJson(400, { message: 'Validation Failed: content and message are required' });
        }

        // Decode incoming base64 content
        let rawBuffer;
        try {
          rawBuffer = Buffer.from(content, 'base64');
        } catch (e) {
          return sendJson(400, { message: 'Invalid base64 encoding' });
        }

        const calculatedSha = computeGitBlobSha(rawBuffer);
        const existing = repoContents.get(normalizedPath);

        // Optimistic Concurrency Checks
        if (existing) {
          if (!sha) {
            return sendJson(409, {
              message: `Conflict: "${normalizedPath}" already exists, sha parameter is required for updates`,
            });
          }
          if (sha !== existing.sha) {
            return sendJson(409, {
              message: `Conflict: "${normalizedPath}" does not match provided sha ${sha} (current: ${existing.sha})`,
            });
          }
        } else {
          // File does not exist yet
          if (sha) {
            return sendJson(404, {
              message: `Not Found: cannot update "${normalizedPath}" because it does not exist`,
            });
          }
        }

        // Create commit
        const commitSha = crypto.randomBytes(20).toString('hex');
        const commitRecord = {
          sha: commitSha,
          message,
          author: author || { name: 'phi5ic', email: 'aravindanilraj0702@gmail.com' },
          committer: committer || { name: 'phi5ic', email: 'aravindanilraj0702@gmail.com' },
          path: normalizedPath,
          timestamp: Date.now(),
          branch: branch || 'main',
        };
        commits.push(commitRecord);

        // Update in-memory storage
        const fileName = normalizedPath.split('/').pop();
        const storedItem = {
          name: fileName,
          path: normalizedPath,
          sha: calculatedSha,
          size: rawBuffer.length,
          type: 'file',
          content: content,
          encoding: 'base64',
        };
        repoContents.set(normalizedPath, storedItem);

        const status = existing ? 200 : 201;
        return sendJson(status, {
          content: {
            name: fileName,
            path: normalizedPath,
            sha: calculatedSha,
            size: rawBuffer.length,
            type: 'file',
          },
          commit: {
            sha: commitSha,
            message: message,
          },
        });
      }
    }

    // Default 404
    sendJson(404, { message: `Not Found: ${method} ${pathname}` });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const boundPort = server.address().port;
      const url = `http://127.0.0.1:${boundPort}`;
      resolve({
        server,
        port: boundPort,
        url,
        reset: () => {
          seedDefaults();
        },
        getRevocations: () => [...revocationLog],
        getCommits: () => [...commits],
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.on('error', reject);
  });
}
