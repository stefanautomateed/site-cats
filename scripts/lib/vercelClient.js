export async function ensureVercelProject({ projectName, repoUrl }) {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token) {
    console.warn('VERCEL_TOKEN not provided; skipping Vercel project creation');
    return null;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  const base = teamId ? `https://api.vercel.com/v9/projects?teamId=${teamId}` : 'https://api.vercel.com/v9/projects';

  // Try to create project
  const res = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: projectName, framework: 'astro' })
  });
  let data;
  if (res.status === 409) {
    // Already exists; fetch
    const getUrl = teamId ? `https://api.vercel.com/v9/projects/${projectName}?teamId=${teamId}` : `https://api.vercel.com/v9/projects/${projectName}`;
    const r = await fetch(getUrl, { headers });
    data = await r.json();
  } else if (!res.ok) {
    throw new Error(`Vercel project create failed: ${res.status} ${await res.text()}`);
  } else {
    data = await res.json();
  }
  return data;
}


