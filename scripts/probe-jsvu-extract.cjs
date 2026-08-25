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
  const r = await get('https://raw.githubusercontent.com/GoogleChromeLabs/jsvu/main/engines/javascriptcore/win64/extract.js');
  console.log('status', r.status);
  console.log(r.body.slice(0, 3000));
})();
