const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const DASHBOARD_USER = process.env.DASHBOARD_USER || "admin";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "change-me";
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
    if (!isAuthorized(req)) {
      sendAuthRequired(res);
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/data") {
      const csv = await fetchText(GOOGLE_CSV_URL);
      send(res, 200, csv, "text/csv; charset=utf-8", {
        "Cache-Control": "no-store",
      });
      return;
    }

    if (url.pathname === "/api/rates") {
      const rates = await fetchText(EXCHANGE_RATE_URL);
      send(res, 200, rates, "application/json; charset=utf-8", {
        "Cache-Control": "max-age=300",
      });
      return;
    }

    const staticFile = publicFiles[url.pathname];
    if (staticFile) {
      const filePath = path.join(__dirname, staticFile.file);
      send(res, 200, fs.readFileSync(filePath), staticFile.type, {
        "Cache-Control": "no-store",
      });
      return;
    }

    send(res, 404, "Not found", "text/plain; charset=utf-8");
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

function isAuthorized(req) {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return safeEqual(user, DASHBOARD_USER) && safeEqual(password, DASHBOARD_PASSWORD);
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
