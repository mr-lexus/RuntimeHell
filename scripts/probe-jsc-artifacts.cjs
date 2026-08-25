// Probe which recent wincairo artifacts are publicly downloadable.
const https = require('node:https');
function head(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': 'rh' } }, (res) => {
      resolve({ status: res.statusCode, len: res.headers['content-length'] });
      res.resume();
    });
    req.on('error', (e) => resolve({ status: -1, len: e.message }));
    req.end();
  });
}

(async () => {
  // Fetch recent builds list
  const builders = await fetch('https://build.webkit.org/api/v2/builders').then((r) => r.json());
  const b = builders.builders.find((x) => /WKL-Release-Build/i.test(x.name) && /wincairo/i.test(x.name));
  const builds = await fetch(
    `https://build.webkit.org/api/v2/builds?builderid=${b.builderid}&order=-number&limit=10&complete=true&property=got_revision`
  ).then((r) => r.json());
  for (const build of builds.builds ?? []) {
    const props = build.properties ?? {};
    let hash = null;
    for (const [k, v] of Object.entries(props)) {
      if (k === 'got_revision') {
        hash = Array.isArray(v) ? String(v[0]) : String(v);
        break;
      }
    }
    if (!hash) continue;
    try {
      const commit = await fetch(`https://api.github.com/repos/WebKit/WebKit/commits/${hash}`, {
        headers: { 'User-Agent': 'rh' }
      }).then((r) => r.json());
      const msg = commit.commit?.message ?? '';
      const m = /Canonical link: https:\/\/commits\.webkit\.org\/(\d+)@main/.exec(msg);
      if (!m) continue;
      const rev = m[1];
      const url = `https://s3-us-west-2.amazonaws.com/archives.webkit.org/wincairo-x86_64-release/${rev}@main.zip`;
      const r = await head(url);
      console.log(`rev ${rev} → ${r.status} (${r.len ?? '?'} bytes)`);
    } catch (e) {
      console.log('skip:', e.message);
    }
  }
})();
