const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const DASHBOARD_USER = process.env.DASHBOARD_USER || "admin";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "change-me";
const SESSION_COOKIE = "finance_bi_session";
const SESSION_SECRET = process.env.SESSION_SECRET || DASHBOARD_PASSWORD;
const GOOGLE_CSV_URL =
  process.env.GOOGLE_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS99e1OqPU9POBbRrJk868WPW93UGR4AiiXjY4eLDoKeaLOLGlAB2h6Mhu0a_eeK5I2dhBw-h5BOqOo/pub?output=csv";
const EXCHANGE_RATE_URL = process.env.EXCHANGE_RATE_URL || "https://open.er-api.com/v6/latest/USD";

const publicFiles = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/login") {
      if (req.method === "POST") {
        await handleLogin(req, res);
        return;
      }
      sendLoginPage(res);
      return;
    }

    if (url.pathname === "/logout") {
      send(res, 303, "", "text/plain; charset=utf-8", {
        "Location": "/login",
        "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      });
      return;
    }

    const auth = getAuthState(req);
    if (!auth.ok) {
      if (isPageRequest(url.pathname)) {
        sendLoginPage(res);
      } else {
        sendAuthRequired(res);
      }
      return;
    }
    const authHeaders = auth.refreshCookie ? { "Set-Cookie": createSessionCookie() } : {};

    if (url.pathname === "/api/data") {
      const csv = await fetchText(GOOGLE_CSV_URL);
      send(res, 200, csv, "text/csv; charset=utf-8", {
        "Cache-Control": "no-store",
        ...authHeaders,
      });
      return;
    }

    if (url.pathname === "/api/rates") {
      const rates = await fetchText(EXCHANGE_RATE_URL);
      send(res, 200, rates, "application/json; charset=utf-8", {
        "Cache-Control": "max-age=300",
        ...authHeaders,
      });
      return;
    }

    const staticFile = publicFiles[url.pathname];
    if (staticFile) {
      const filePath = path.join(__dirname, staticFile.file);
      send(res, 200, fs.readFileSync(filePath), staticFile.type, {
        "Cache-Control": "no-store",
        ...authHeaders,
      });
      return;
    }

    send(res, 404, "Not found", "text/plain; charset=utf-8", authHeaders);
  } catch (error) {
    console.error(error);
    send(res, 502, "Dashboard service error", "text/plain; charset=utf-8");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard running at http://${HOST}:${PORT}`);
  if (DASHBOARD_PASSWORD === "change-me") {
    console.warn("Set DASHBOARD_USER and DASHBOARD_PASSWORD before sharing this dashboard.");
  }
});

function getAuthState(req) {
  if (isValidSession(req)) {
    return { ok: true, refreshCookie: false };
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return { ok: false, refreshCookie: false };

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return { ok: false, refreshCookie: false };

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const ok = safeEqual(user, DASHBOARD_USER) && safeEqual(password, DASHBOARD_PASSWORD);
  return { ok, refreshCookie: ok };
}

function isValidSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const session = cookies[SESSION_COOKIE];
  if (!session) return false;

  const expected = signSession(DASHBOARD_USER);
  return safeEqual(session, expected);
}

function createSessionCookie() {
  const value = signSession(DASHBOARD_USER);
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
}

function signSession(user) {
  const payload = Buffer.from(String(user)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function parseCookies(header) {
  return header.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator === -1) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function isPageRequest(pathname) {
  return pathname === "/" || pathname === "/index.html";
}

async function handleLogin(req, res) {
  const body = await readRequestBody(req);
  const form = new URLSearchParams(body);
  const user = form.get("user") || "";
  const password = form.get("password") || "";

  if (safeEqual(user, DASHBOARD_USER) && safeEqual(password, DASHBOARD_PASSWORD)) {
    send(res, 303, "", "text/plain; charset=utf-8", {
      "Location": "/index.html",
      "Set-Cookie": createSessionCookie(),
    });
    return;
  }

  sendLoginPage(res, "账号或密码错误");
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendLoginPage(res, error = "") {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  send(
    res,
    200,
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>登录 - 个人财务BI看板</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f5f8fc;
        color: #07162f;
        font-family: "Inter", "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
      }
      .login {
        width: min(420px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid #dbe4ef;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 8px 24px rgba(20, 38, 66, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 26px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 22px;
        color: #64748b;
      }
      label {
        display: block;
        margin: 14px 0 7px;
        font-weight: 700;
      }
      input {
        width: 100%;
        height: 46px;
        padding: 0 12px;
        border: 1px solid #cfd9e6;
        border-radius: 8px;
        color: #07162f;
        font: inherit;
      }
      button {
        width: 100%;
        height: 48px;
        margin-top: 22px;
        border: 0;
        border-radius: 8px;
        background: #1267ff;
        color: #fff;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
      .error {
        margin: 14px 0 0;
        color: #fb1f1f;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <form class="login" method="post" action="/login">
      <h1>个人财务BI看板</h1>
      <p>请输入账号密码查看实时数据。</p>
      <label for="user">账号</label>
      <input id="user" name="user" autocomplete="username" required />
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">登录</button>
      ${errorHtml}
    </form>
  </body>
</html>`,
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendAuthRequired(res) {
  send(res, 401, "Authentication required", "text/plain; charset=utf-8", {
    "WWW-Authenticate": 'Basic realm="Finance BI Dashboard", charset="UTF-8"',
    "Cache-Control": "no-store",
  });
}

function send(res, statusCode, body, contentType, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(body);
}

function fetchText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "finance-bi-dashboard/1.0" } }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (!response.headers.location || redirectCount >= 5) {
            reject(new Error(`Upstream redirect failed: ${response.statusCode}`));
            return;
          }
          const nextUrl = new URL(response.headers.location, url).toString();
          fetchText(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`Upstream HTTP ${response.statusCode}`));
          return;
        }

        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      })
      .on("error", reject)
      .setTimeout(15000, function timeout() {
        this.destroy(new Error("Upstream request timeout"));
      });
  });
}
