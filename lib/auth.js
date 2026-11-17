const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

let loginPromise = null; // Prevent concurrent browser launches
let blockedUntil = 0; // Cool-down so public traffic cannot trigger repeated browser logins
const COOLDOWN_OK_MS = 60 * 1000; // a fresh login should not need redoing right away
const COOLDOWN_FAIL_MS = 5 * 60 * 1000; // failed login: back off (also avoids locking the MCV account)

async function refreshCookie() {
  if (loginPromise) return loginPromise;
  if (Date.now() < blockedUntil) throw new Error('auto-login is cooling down');

  loginPromise = (async () => {
    const username = process.env.MCV_USERNAME;
    const password = process.env.MCV_PASSWORD;

    if (!username || !password) {
      throw new Error('MCV_USERNAME or MCV_PASSWORD is not set for auto-login');
    }

    console.log('[Auth] Cookie expired or missing. Starting auto-login via myCourseVille...');

    const isVercel = !!process.env.VERCEL;
    let launchOptions;

    if (isVercel) {
      // Dynamically import ESM package inside CommonJS module
      const { default: chromiumPack } = await import('@sparticuz/chromium');
      launchOptions = {
        args: chromiumPack.args,
        executablePath: await chromiumPack.executablePath(),
        headless: true,
      };
    } else {
      launchOptions = {
        headless: true,
        channel: 'chrome', // Use 'msedge' if Google Chrome is not installed locally
      };
    }

    const browser = await chromium.launch(launchOptions);

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      // 1. Navigate to the main CEDT Intern page
      await page.goto('https://cedtintern.cp.eng.chula.ac.th/', { waitUntil: 'networkidle' });

      // 2. Click the "เข้าสู่ระบบด้วยบัญชี myCourseVille" button
      await page.getByRole('button', { name: /เข้าสู่ระบบด้วยบัญชี myCourseVille/i }).click();

      // 3. Wait for and click the myCourseVille login button
      const mcvLoginBtn = page.locator('.btn.btn-default.cv-default-bs.cv-login-loginbutton');
      await mcvLoginBtn.waitFor({ state: 'visible', timeout: 15000 });
      await mcvLoginBtn.click();

      // 4. Wait for the username and password inputs to load
      await page.waitForSelector('input[type="password"]', { timeout: 15000 });

      const userInput = page.locator('input[name="username"], input[id="username"], input[type="text"]').first();
      const passInput = page.locator('input[type="password"]').first();

      await userInput.fill(username);
      await passInput.fill(password);

      // 5. Submit the form and wait until redirected back to cedtintern
      await Promise.all([
        page.waitForURL('https://cedtintern.cp.eng.chula.ac.th/**', { timeout: 20000 }),
        passInput.press('Enter'),
      ]);

      // Wait for initial session/dashboard requests to settle
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);

      // 6. Extract all cookies for the cedtintern domain
      const cookies = await context.cookies('https://cedtintern.cp.eng.chula.ac.th');
      if (!cookies.length) {
        throw new Error('Login seemed to succeed, but no cookies were captured.');
      }

      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

      // Update the environment variable in memory immediately
      process.env.UPSTREAM_COOKIE = cookieHeader;

      // Persist the updated cookie to .env for local/server restarts
      updateEnvFile('UPSTREAM_COOKIE', cookieHeader);

      console.log('[Auth] Auto-login successful! New cookie obtained.');
      return cookieHeader;
    } finally {
      await browser.close();
    }
  })();

  // Runs on every outcome, including failures before the browser launches (missing credentials,
  // Chromium launch error): always clear the in-flight promise and start a cool-down.
  const p = loginPromise;
  p.then(
    () => { blockedUntil = Date.now() + COOLDOWN_OK_MS; },
    () => { blockedUntil = Date.now() + COOLDOWN_FAIL_MS; }
  ).finally(() => { loginPromise = null; });

  return p;
}

function updateEnvFile(key, value) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;

    let content = fs.readFileSync(envPath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const newLine = `${key}="${value}"`;

    if (regex.test(content)) {
      content = content.replace(regex, newLine);
    } else {
      content += `\n${newLine}\n`;
    }
    fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(envPath, 0o600); } catch { /* best effort */ }
  } catch (err) {
    // Ignore write errors in read-only serverless environments (e.g., Vercel)
  }
}

module.exports = { refreshCookie };