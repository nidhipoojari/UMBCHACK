/**
 * GitHub enrichment. Given the GitHub link from a resume, fetches the public
 * profile and the person's own repositories from GitHub's REST API.
 *
 * The API rather than scraping github.com: it is structured, stable, and within
 * GitHub's terms. Unauthenticated calls get 60 requests an hour per IP; set
 * GITHUB_TOKEN (a fine-grained token with no scopes is enough for public data)
 * to raise that to 5,000.
 */

// Paths on github.com that are not user profiles.
const RESERVED = new Set(['orgs', 'features', 'about', 'pricing', 'topics', 'collections', 'marketplace', 'settings']);

/** "github.com/ada", "https://www.github.com/ada/", "@ada" on a GitHub line → "ada". */
export function githubLogin(url) {
  const match = /github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?:[/?#]|$)/i.exec(url ?? '');
  if (!match || RESERVED.has(match[1].toLowerCase())) return null;
  return match[1];
}

export class GitHubNotFound extends Error {}

async function get(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'agentHire-resume-extractor', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) throw new GitHubNotFound(`No GitHub user at ${path}`);
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}

/** The profile plus up to 30 of the person's own repos, most recently pushed first. */
export async function fetchGitHub(login) {
  const [user, repos] = await Promise.all([
    get(`/users/${encodeURIComponent(login)}`),
    get(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=30`),
  ]);

  const own = repos.filter((repo) => !repo.fork);
  const languageCounts = new Map();
  for (const repo of own) {
    if (repo.language) languageCounts.set(repo.language, (languageCounts.get(repo.language) ?? 0) + 1);
  }
  const topLanguages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([language]) => language);

  return {
    login: user.login,
    name: user.name,
    bio: user.bio,
    company: user.company,
    blog: user.blog || null,
    location: user.location,
    publicRepos: user.public_repos,
    followers: user.followers,
    createdAt: user.created_at,
    profileUrl: user.html_url,
    topLanguages,
    totalStars: own.reduce((sum, repo) => sum + repo.stargazers_count, 0),
    repos: own.map((repo) => ({
      name: repo.name,
      description: repo.description,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      topics: repo.topics ?? [],
      url: repo.html_url,
      pushedAt: repo.pushed_at,
    })),
  };
}
