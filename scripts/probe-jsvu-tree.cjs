const https = require('node:https');
function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: -1, body: e.message }));
  });
}

(async () => {
  const idx = await get('https://api.github.com/repos/GoogleChromeLabs/jsvu/git/trees/main?recursive=1');
  const tree = JSON.parse(idx.body).tree.map((t) => t.path).filter((p) => p.includes('javascriptcore'));
  console.log(tree.join('\n'));
})();
