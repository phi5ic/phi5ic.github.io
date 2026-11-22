export interface RepoFileResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
}

export function toBase64Utf8(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64');
}

export function fromBase64Utf8(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf-8');
}

export function getGitHubConfig() {
  const baseUrl = (process.env.GITHUB_API_URL || process.env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/+$/, '');
  const owner = process.env.GITHUB_REPO_OWNER || 'phi5ic';
  const repo = process.env.GITHUB_REPO_NAME || 'phi5ic.github.io';
  const branch = process.env.GITHUB_BRANCH || 'main';
  return { baseUrl, owner, repo, branch };
}

export async function getRepoFile(filePath: string, token: string): Promise<RepoFileResponse | null> {
  const { baseUrl, owner, repo } = getGitHubConfig();

  const res = await fetch(`${baseUrl}/repos/${owner}/${repo}/contents/${filePath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'phi5ic-blog-publisher',
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`GitHub get file failed: ${res.status} ${await res.text()}`);
  }

  return await res.json();
}

export async function putRepoFile({
  path,
  content,
  message,
  sha,
  branch,
  token,
}: {
  path: string;
  content: string;
  message: string;
  sha?: string;
  branch?: string;
  token: string;
}) {
  const config = getGitHubConfig();
  const targetBranch = branch || config.branch;

  const base64Content = toBase64Utf8(content);
  const payload: Record<string, any> = {
    message,
    content: base64Content,
    branch: targetBranch,
  };
  if (sha) {
    payload.sha = sha;
  }

  const res = await fetch(`${config.baseUrl}/repos/${config.owner}/${config.repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'phi5ic-blog-publisher',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return { status: res.status, data };
}
