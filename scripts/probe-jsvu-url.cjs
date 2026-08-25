const https = require('node:https');
function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ status: -1, body: e.message }));
  });
}

(async () => {
  const candidates = [
    'https://raw.githubusercontent.com/GoogleChromeLabs/jsvu/main/engines/javascriptcore/win64/get-latest-version.js',
    'https://raw.githubusercontent.com/GoogleChromeLabs/jsvu/main/engines/javascriptcore/get-latest-version.js'
  ];
  for (const url of candidates) {
    const r = await get(url);
    console.log('=== ' + url + ' → ' + r.status);
    if (r.status === 200) {
      console.log(r.body.slice(0, 1800));
      break;
    }
  }
})();
