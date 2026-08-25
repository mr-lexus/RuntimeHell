// Probe older wincairo artifacts for public availability.
const https = require('node:https');
function head(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', () => resolve({ status: -1 }));
    req.end();
  });
}

(async () => {
  const builds = await fetch(
    'https://build.webkit.org/api/v2/builds?builderid=27&order=-number&limit=50&complete=true&property=got_revision'
  ).then((r) => r.json());
  const seen = new Set();
  let checked = 0;
  for (const b of builds.builds ?? []) {
    if (checked >= 8) break;
    const props = b.properties ?? {};
    let hash = null;
    for (const [k, v] of Object.entries(props)) {
      if (k === 'got_revision') { hash = Array.isArray(v) ? String(v[0]) : String(v); break; }
    }
    if (!hash) continue;
    try {
      const c = await fetch('https://api.github.com/repos/WebKit/WebKit/commits/' + hash, { headers: { 'User-Agent': 'rh' } }).then((r) => r.json());
      const m = /Canonical link: https:\/\/commits\.webkit\.org\/(\d+)@main/.exec(c.commit?.message || '');
      if (!m) continue;
      const rev = m[1];
      if (seen.has(rev)) continue;
      seen.add(rev);
      const url = `https://s3-us-west-2.amazonaws.com/archives.webkit.org/wincairo-x86_64-release/${rev}@main.zip`;
      const st = await head(url);
      console.log(`rev ${rev} → ${st.status}`);
      checked++;
    } catch {}
  }
})();
