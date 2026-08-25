// Probe archive.mozilla.org listing for jsshell asset naming on a given release.
const https = require('node:https');
function get(url) {
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location).then(resolve);
        }
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', (e) => resolve({ status: -1, body: String(e) }));
  });
}

(async () => {
  const listing = await get('https://archive.mozilla.org/pub/firefox/releases/140.14.0esr/');
  console.log('listing status', listing.status);
  const matches = [...listing.body.matchAll(/href="([^"]*jsshell[^"]*)"/g)].map((m) => m[1]);
  console.log('jsshell hrefs:', matches.slice(0, 10));
})();
