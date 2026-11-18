// Build the static website for a separate host (Cloudflare Pages, Netlify, Vercel...) whose data comes from
// the Raspberry Pi API:
//   PI_URL=https://my-pi.tailnet-name.ts.net node scripts/build-static.js
// Output: dist/  (the public/ folder + config.js pointing at the Pi + security headers for the host)
const fs = require('fs');
const path = require('path');

const raw = process.env.PI_URL || process.argv[2];
let origin;
try {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || (u.pathname !== '/' && u.pathname !== '')) throw new Error();
  origin = u.origin;
} catch {
  console.error('Set PI_URL to the https address of the Pi API, e.g.  PI_URL=https://my-pi.tailnet-name.ts.net npm run build:static');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.writeFileSync(path.join(out, 'config.js'), `window.APP_CONFIG = { apiBase: ${JSON.stringify(origin)} };\n`);

const csp = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
  `img-src 'self' data: ${origin}`, `connect-src 'self' ${origin}`, "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': csp,
};
// Cloudflare Pages and Netlify read "_headers"; Vercel reads "vercel.json".
fs.writeFileSync(path.join(out, '_headers'), `/*\n${Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n`);
fs.writeFileSync(path.join(out, 'vercel.json'), JSON.stringify({
  headers: [{ source: '/(.*)', headers: Object.entries(headers).map(([key, value]) => ({ key, value })) }],
}, null, 2) + '\n');

console.log(`dist/ ready (data from ${origin}). Deploy the dist folder; remember WEB_ORIGINS on the Pi must contain your site's address.`);
