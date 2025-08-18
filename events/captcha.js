const axios = require("axios");
const chalk = require("chalk");
const date = require("date-and-time");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const config = require("../config.js");

const { captcha: captchaConfig, webhookUrls } = config;
const { licenseKey, API_URL, shuApiKey, shuHostname, mode } = captchaConfig;

// File paths
const statsFile = path.join(__dirname, "../data/stats.json");
const captchaStatsFile = path.join(__dirname, "../data/captchaStats.json");

// Ensure dirs + files
if (!fs.existsSync(path.dirname(statsFile)))
  fs.mkdirSync(path.dirname(statsFile), { recursive: true });
if (!fs.existsSync(statsFile)) fs.writeFileSync(statsFile, "{}");
if (!fs.existsSync(captchaStatsFile)) fs.writeFileSync(captchaStatsFile, "{}");

// JSON helpers
function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file));
  } catch {
    return {};
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Init stats for a client
function initCaptchaStats(clientId, username) {
  const captchaStats = loadJSON(captchaStatsFile);
  const stats = loadJSON(statsFile);

  if (!captchaStats[clientId]) {
    captchaStats[clientId] = { username, detected: 0, solved: 0, failed: 0 };
  }
  if (!stats[clientId]) {
    stats[clientId] = {
      username,
      catches: {},
      coins: 0,
      captcha: { detected: 0, solved: 0, failed: 0 },
    };
  } else if (!stats[clientId].captcha) {
    stats[clientId].captcha = { detected: 0, solved: 0, failed: 0 };
  }

  saveJSON(captchaStatsFile, captchaStats);
  saveJSON(statsFile, stats);
}

// Update stats.json + captchaStats.json
function updateCaptchaStats(clientId, updater) {
  const captchaStats = loadJSON(captchaStatsFile);
  const stats = loadJSON(statsFile);

  if (!captchaStats[clientId] || !stats[clientId]) return;
  updater(captchaStats[clientId], stats[clientId]);
  saveJSON(captchaStatsFile, captchaStats);
  saveJSON(statsFile, stats);
}

// --- Shu Mode Solver ---
function solveCaptchaShu(apiKey, userId, token, hostname) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ userId, token });

    let host = hostname;
    let port = 443;
    let useHttps = true;

    if (hostname.includes(":")) {
      const parts = hostname.split(":");
      host = parts[0];
      port = parseInt(parts[1]);
      useHttps = port === 443;
    }

    const options = {
      hostname: host,
      port,
      path: "/solve",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data.length,
        "x-api-key": apiKey,
      },
    };

    const req = (useHttps ? https : http).request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => {
        responseData += chunk;
      });
      res.on("end", () => {
        try {
          const jsonResponse = JSON.parse(responseData);
          if (jsonResponse.result) {
            resolve({ success: true, result: jsonResponse.result });
          } else {
            resolve({ success: false, error: "Captcha solving failed" });
          }
        } catch (err) {
          reject(new Error(`Error parsing response: ${err.message}`));
        }
      });
    });

    req.on("error", (error) =>
      reject(new Error(`Request error: ${error.message}`)),
    );
    req.write(data);
    req.end();
  });
}

// --- Leo Mode Solver ---
async function solveCaptchaLeo(token, clientId) {
  try {
    const response = await axios.post(
      API_URL,
      { token, clientId, licenseKey },
      { timeout: 65000 },
    );
    return response.data;
  } catch (err) {
    if (err.response && err.response.status === 524) {
      return { pending: true };
    } else if (err.code === "ECONNABORTED") {
      return { pending: true };
    } else {
      return { success: false, error: err.message };
    }
  }
}

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    // Detect captcha link
    const captchaMatch = message?.content.match(
      /https:\/\/verify\.poketwo\.net\/captcha\/(\d+)/,
    );
    if (!captchaMatch) return;

    const clientId = captchaMatch[1];
    const token = client.token;
    const now = Date.now();

    initCaptchaStats(clientId, client.user.username);
    const captchaStats = loadJSON(captchaStatsFile);
    const lastTime = captchaStats[clientId]?.lastTime;

    // Skip duplicate captcha (5 min window)
    if (lastTime && now - lastTime < config.skipDuplicateWindow) {
      console.log(
        chalk.yellow(
          `[${date.format(new Date(), "YYYY-MM-DD HH:mm:ss")}] Skipping duplicate captcha for ${client.user.username} | @ryomen.leo`,
        ),
      );
      return;
    }

    // Mark detection
    updateCaptchaStats(clientId, (c, s) => {
      c.lastTime = now;
      c.detected++;
      s.captcha.detected++;
    });
    client.captchaPaused = true;

    console.log(
      `[${date.format(new Date(), "YYYY-MM-DD HH:mm:ss")}] ${chalk.red(client.user.username)} → CAPTCHA detected, pausing catch | @ryomen.leo`,
    );

    // --- Webhook: Detected ---
    try {
      // reload stats after increment
      const updatedStats = loadJSON(captchaStatsFile);

      await axios
        .post(webhookUrls.captcha, {
          username: "LeO Captcha Logs",
          embeds: [
            {
              title: "⚠️ Captcha Detected",
              color: 0xff9800,
              description:
                `Pookie: ${client.user.username}\n` +
                `Total Detected: ${updatedStats[clientId]?.detected || 0}\n` +
                `Total Solved: ${updatedStats[clientId]?.solved || 0}`,
              footer: { text: "Developed by @ryomen.leo" },
              timestamp: new Date(),
            },
          ],
        })
        .catch(() => null); // ✅ ignore webhook errors silently
    } catch (err) {
      console.error(
        chalk.red("❌ Failed to send detected webhook: " + err.message),
      );
    }

    try {
      const timeout = Date.now() + config.solveTimeout;
      let solved = false,
        solveSpeed = null,
        attempt = null;

      while (!solved && Date.now() < timeout) {
        let result;

        if (mode === "leo") {
          result = await solveCaptchaLeo(token, clientId);
          if (result.success) {
            solved = true;
            solveSpeed = result.speed;
            attempt = result.attempt;
          } else if (result.pending) {
            console.log(
              chalk.yellow("⏳ Solver still working... | @ryomen.leo"),
            );
          } else {
            console.log(
              chalk.red(`❌ Leo solver error: ${result.error} | @ryomen.leo`),
            );
          }
        } else if (mode === "shu") {
          try {
            result = await solveCaptchaShu(
              shuApiKey,
              clientId,
              token,
              shuHostname,
            );
            if (result.success) {
              solved = true;
              solveSpeed = null;
              attempt = "shu-mode";
            } else {
              console.log(
                chalk.red(`❌ Shu solver error: ${result.error} | @ryomen.leo`),
              );
            }
          } catch (err) {
            console.log(
              chalk.red(
                `❌ Shu solver request failed: ${err.message} | @ryomen.leo`,
              ),
            );
          }
        }

        if (!solved) await new Promise((r) => setTimeout(r, config.retryDelay));
      }

      if (!solved) {
        updateCaptchaStats(clientId, (c, s) => {
          c.failed++;
          s.captcha.failed++;
        });
        console.log(
          chalk.yellow(
            `⚠️ Timeout (${config.solveTimeout / 1000}s) — resuming catch for ${client.user.username} | @ryomen.leo`,
          ),
        );

        await axios
          .post(webhookUrls.captcha, {
            username: "LeO Captcha Logs",
            embeds: [
              {
                title: "❌ Captcha Failed",
                color: 0xf44336,
                description: `Pookie: ${client.user.username}\nTotal Detected: ${captchaStats[clientId].detected}\nTotal Solved: ${captchaStats[clientId].solved}\nTotal Failed: ${captchaStats[clientId].failed + 1}`,
                footer: { text: "Developed by @ryomen.leo" },
                timestamp: new Date(),
              },
            ],
          })
          .catch((e) => console.error("❌ Webhook error:", e.message));
      } else {
        updateCaptchaStats(clientId, (c, s) => {
          c.solved++;
          s.captcha.solved++;
        });
        console.log(
          chalk.green(
            `✅ Captcha solved for ${client.user.username} | Speed: ${solveSpeed?.toFixed(2) || "N/A"}s | Mode: ${mode} | @ryomen.leo`,
          ),
        );

        await axios
          .post(webhookUrls.captcha, {
            username: "LeO Captcha Logs",
            embeds: [
              {
                title: "✅ Captcha Solved",
                color: 0x4caf50,
                description: `Pookie: ${client.user.username}\nSolve Speed: ${solveSpeed?.toFixed(2) || "N/A"}s\nAttempt: ${attempt || "N/A"}\nTotal Detected: ${captchaStats[clientId].detected}\nTotal Solved: ${captchaStats[clientId].solved + 1}`,
                footer: { text: "Developed by @ryomen.leo" },
                timestamp: new Date(),
              },
            ],
          })
          .catch((e) => console.error("❌ Webhook error:", e.message));
      }
    } catch (err) {
      console.error(
        chalk.red(`❌ Fatal Captcha Error: ${err.message} | @ryomen.leo`),
      );
    } finally {
      client.captchaPaused = false;
      console.log(
        chalk.green(
          `[${date.format(new Date(), "YYYY-MM-DD HH:mm:ss")}] Resumed catch for ${client.user.username} | @ryomen.leo`,
        ),
      );
    }
  });
};
