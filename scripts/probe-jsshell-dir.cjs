const https = require('node:https');
https.get('https://archive.mozilla.org/pub/firefox/releases/140.14.0esr/jsshell/', (r) => {
  let b = '';
  r.on('data', (d) => (b += d));
  r.on('end', () => {
    const links = [...b.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((x) => x.includes('win64'));
    console.log(links.join('\n'));
  });
});
