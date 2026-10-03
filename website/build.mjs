import { mkdir, readFile, writeFile, cp, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { content } from './content.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const destination = join(root, 'website/dist');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const base = 'https://mr-lexus.github.io/RuntimeHell/';
const repo = 'https://github.com/mr-lexus/RuntimeHell';
const release = `${repo}/releases/tag/v${version}`;
const asset = (file) => `${repo}/releases/download/v${version}/${file}`;
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
await mkdir(join(destination, 'ru'), { recursive: true });
await cp(join(root, 'website/assets'), join(destination, 'assets'), { recursive: true });
await copyFile(join(root, 'logo.svg'), join(destination, 'assets/logo.svg'));
for (const file of ['styles.css', 'app.js']) await copyFile(join(root, 'website', file), join(destination, file));

for (const [lang, c] of Object.entries(content)) {
  const prefix = lang === 'ru' ? '../' : './';
  const url = base + (lang === 'ru' ? 'ru/' : '');
  const picture = (name, alt, hero = false) => `<a class="screen-link" href="${prefix}assets/screens/${name}.png" data-lightbox aria-label="${escape(c.enlarge)}"><img src="${prefix}assets/screens/${name}.png" alt="${escape(alt)}" width="1600" height="1000" ${hero ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"><span class="zoom" aria-hidden="true">↗</span></a>`;
  const platformFiles = [`RuntimeHell-${version}-win-x64.exe`, `RuntimeHell-${version}-mac-arm64.dmg`, `RuntimeHell-${version}-mac-x64.dmg`, `RuntimeHell-${version}-linux-x86_64.AppImage`];
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light">
<title>${escape(c.title)}</title><meta name="description" content="${escape(c.description)}"><link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="${base}"><link rel="alternate" hreflang="ru" href="${base}ru/"><link rel="alternate" hreflang="x-default" href="${base}">
<meta property="og:type" content="website"><meta property="og:title" content="${escape(c.title)}"><meta property="og:description" content="${escape(c.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${base}assets/screens/workspace.png"><meta property="og:locale" content="${lang === 'ru' ? 'ru_RU' : 'en_US'}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${prefix}assets/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="${prefix}styles.css"><script src="${prefix}app.js" defer></script>
</head><body>
<a class="skip" href="#main">${c.skip}</a>
<header class="header"><div class="container nav"><a class="brand" href="${prefix}" aria-label="RuntimeHell"><img src="${prefix}assets/logo.svg" alt="" width="32" height="32">RuntimeHell<span class="beta">BETA</span></a><nav aria-label="${lang === 'ru' ? 'Главная навигация' : 'Main navigation'}"><a href="#workbench">${c.nav[0]}</a><a href="#features">${c.nav[1]}</a><a class="nav-download" href="#download">${c.nav[2]} <span aria-hidden="true">↗</span></a></nav><div class="languages" aria-label="${c.lang}"><a href="${prefix}" lang="en" hreflang="en" ${lang === 'en' ? 'aria-current="page"' : ''}>EN</a><span>/</span><a href="${prefix}ru/" lang="ru" hreflang="ru" ${lang === 'ru' ? 'aria-current="page"' : ''}>RU</a></div></div></header>
<main id="main">
<section class="hero container" id="workbench"><div class="eyebrow"><span class="status-dot"></span>${c.badge}</div><h1>${c.hero[0]}<br><em>${c.hero[1]}</em></h1><p class="hero-copy">${c.intro}</p><div class="hero-actions"><a class="button primary" href="#download">${c.cta}<span aria-hidden="true">↓</span></a><a class="text-link" href="${repo}">${c.source} <span aria-hidden="true">↗</span></a></div><p class="platform-note">${c.platforms}<span>v${version}</span></p>
<figure class="hero-screen"><div class="frame-top"><span><i></i><i></i><i></i></span><span>RUNTIMEHELL / WORKSPACE</span><span>JS + TS</span></div>${picture('workspace', c.screenAlt, true)}<figcaption><span class="status-dot"></span>${c.caption}</figcaption></figure></section>
<section class="runtimes container" aria-label="Runtimes"><p class="eyebrow">${c.runtimeLabel}</p><div><span>Node<span class="runtime-dot">.js</span></span><span>Deno<span class="runtime-dot"> ↗</span></span><span>Bun<span class="runtime-dot">.</span></span><span>Chromium<span class="runtime-dot"> ◉</span></span></div></section>
<section class="manifesto container reveal"><span class="section-mark" aria-hidden="true">[ rh ]</span><h2>${c.manifesto[0]}<br><span>${c.manifesto[1]}</span></h2><p>${c.manifestoText}</p></section>
<section id="features" class="feature values-feature container reveal"><div class="feature-copy"><p class="eyebrow">${c.featureIntro}</p><h2>${c.featureTitle}</h2><p>${c.featureText}</p><ul>${c.featureBullets.map((item) => `<li><span aria-hidden="true">↳</span>${item}</li>`).join('')}</ul></div><div class="value-demo" aria-hidden="true"><div class="mini-label">SOURCE <span>→</span> VALUES</div><pre><span class="token-purple">const</span> project = {
  name: <span class="token-green">"RuntimeHell"</span>,
  curious: <span class="token-yellow">true</span>
};</pre><div class="value-card"><div><span>⌄</span> Object</div><p>name: <b>"RuntimeHell"</b></p><p>curious: <b>true</b></p><div class="proto">↳ [[Prototype]] → Object</div></div><small>JavaScript · ${lang === 'ru' ? 'Пример отображения значения' : 'Value display example'}</small></div></section>
<section class="performance container reveal"><div class="section-heading"><div><p class="eyebrow">${c.perfIntro}</p><h2>${c.perfTitle}</h2></div><p>${c.perfText}</p></div><figure class="product-frame">${picture('performance', c.perfAlt)}<figcaption>${c.perfCaption}</figcaption></figure></section>
<section class="layout-band"><div class="container layout-section reveal"><div class="feature-copy"><p class="eyebrow">${c.layoutIntro}</p><h2>${c.layoutTitle}</h2><p>${c.layoutText}</p><div class="layout-tags"><span>Code</span><span>Run</span><span>Analyze</span><span>Focus</span></div></div><figure class="layout-shot">${picture('layout', c.layoutAlt)}</figure></div></section>
<section class="tools container reveal"><h2>${c.moreTitle}</h2><div class="tool-grid">${c.tools.map(([symbol, title, text]) => `<article><span class="tool-symbol" aria-hidden="true">${symbol}</span><h3>${title}</h3><p>${text}</p></article>`).join('')}</div></section>
<section id="download" class="download container reveal"><p class="eyebrow">${c.downloadEyebrow}</p><h2>${c.downloadTitle}</h2><p class="download-copy">${c.downloadText}</p><div class="release-label"><span class="status-dot"></span>v${version}</div><div class="download-grid">${platformFiles.map((file, index) => `<a href="${asset(file)}" class="download-card"><span class="download-arrow" aria-hidden="true">↓</span><strong>${c.downloadNames[index]}</strong><span>${c.downloadDetails[index]}</span></a>`).join('')}</div><div class="download-links"><a href="${release}">${c.allDownloads} ↗</a><a href="${asset('SHA256SUMS.txt')}">${c.checksums} ↗</a></div><aside class="caution"><strong>${c.cautionTitle}</strong><p>${c.caution}</p></aside></section>
<section class="faq container reveal"><h2>${c.faqTitle}</h2><div>${c.faq.map(([question, answer]) => `<details><summary>${question}<span aria-hidden="true">+</span></summary><p>${answer}</p></details>`).join('')}</div></section>
</main><footer class="container"><div><a class="brand" href="${prefix}"><img src="${prefix}assets/logo.svg" alt="" width="28" height="28">RuntimeHell</a><p>${c.footer}</p></div><div><a href="${repo}">${c.github} ↗</a><a href="${repo}/issues">${c.issues} ↗</a><small>${c.privacy}</small></div></footer>
<dialog class="lightbox" aria-label="${escape(c.enlarge)}"><button type="button" aria-label="${escape(c.close)}">×</button><img alt=""><p></p></dialog>
</body></html>`;
  await writeFile(join(destination, lang === 'ru' ? 'ru/index.html' : 'index.html'), html);
}
await writeFile(join(destination, '.nojekyll'), '');
await writeFile(join(destination, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`);
await writeFile(join(destination, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}</loc></url><url><loc>${base}ru/</loc></url></urlset>`);
console.log(`Built English and Russian website for v${version}: ${destination}`);
