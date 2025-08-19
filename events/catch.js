const { solveHint, checkRarity, getImage } = require("pokehint");
const chalk = require("chalk");
const date = require("date-and-time");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const config = require("../config.js");

const { catchMode, genderEmojis, webhookUrls, rarityColors } = config;

axios.interceptors.response.use(
    response => response, // Pass through successful responses
    error => {
        if (error.response && error.response.status === 429) {
            return Promise.resolve(); // Ignore the error and continue
        }
        return Promise.reject(error); // Reject other errors
    }
);

// Ensure data folder + stats.json exists
const dataDir = path.join(__dirname, "../data");
const statsFile = path.join(dataDir, "stats.json");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(statsFile)) fs.writeFileSync(statsFile, "{}");

// Load stats JSON
function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(statsFile, "utf-8"));
  } catch {
    return {};
  }
}

// Save stats JSON
function saveStats(data) {
  fs.writeFileSync(statsFile, JSON.stringify(data, null, 2));
}

// Update stats for a client
function updateStats(client, rarity, shiny, gigantamax, coins = 0) {
  const stats = loadStats();
  const key = client.user.id;

  if (!stats[key]) {
    stats[key] = {
      username: client.user.username,
      catches: {},
      pokecoins: 0,
    };
  }

  if (rarity) {
    if (!stats[key].catches[rarity]) {
      stats[key].catches[rarity] = 0;
    }
    stats[key].catches[rarity]++;
  }

  if (shiny) {
    if (!stats[key].catches["Shiny"]) stats[key].catches["Shiny"] = 0;
    stats[key].catches["Shiny"]++;
  }

  if (gigantamax) {
    if (!stats[key].catches["Gigantamax"]) stats[key].catches["Gigantamax"] = 0;
    stats[key].catches["Gigantamax"]++;
  }

  if (coins > 0) {
    stats[key].pokecoins += coins;
  }

  saveStats(stats);
}

function getRandomColor(palette) {
  return palette[Math.floor(Math.random() * palette.length)];
}

module.exports = (client) => {
  client.on("messageCreate", async (message) => {
    if (message.author.id === "716390085896962058") {
      if (message.content.includes("Please pick a starter pokémon")) {
        try {
          await message.channel
            .send("<@716390085896962058> pick charmander")
            .catch(() => null);
          await new Promise((resolve) => setTimeout(resolve, 10000));

          await message.channel.send("<@716390085896962058> sh mewtwo");
        } catch (err) {
          console.error("❌ Error auto-picking starter:", err.message);
        }
        return; // stop here so normal catch flow doesn’t run
      }
    }

    if (
      message.components?.length > 0 &&
      message.author.id === "716390085896962058"
    ) {
      for (const row of message.components) {
        for (const button of row.components) {
          const label = button.label?.toLowerCase();
          const isConfirm =
            label === "confirm" || label === "accept" || button.style === 3;

          if (isConfirm) {
            // === Mode 1: Positional click (fallback for old style buttons)
            try {
              await message.clickButton({ X: 0, Y: 0 });
              console.log("✅ Positional Confirm click sent.");
            } catch (err) {
              // optional: silent log
            }

            // === Mode 2: Proper customId click
            if (button.customId) {
              try {
                await message.clickButton(button.customId);
                console.log("✅ Clicked Confirm button via customId.");
              } catch (err) {
                if (!err.message.includes("No responsed")) {
                  console.error(
                    "❌ Error clicking confirm button:",
                    err.message,
                  );
                }
              }
            }
            // ⚠️ No return here — allow the rest of your message handlers to still run
          }
        }
      }
    }

    if (client.captchaPaused) {
      console.log(
        `[${date.format(new Date(), "YYYY-MM-DD HH:mm:ss")}] Catch paused due to captcha for ${client.user.username}`,
      );
      return;
    }

    // --- AI MODE (Lenda bot output) ---
    if (catchMode === "lenda") {
      if (
        message.author.bot &&
        message.content.match(/^[A-Za-z0-9 .'-]+: \d+(\.\d+)?%$/)
      ) {
        const [pokemonName] = message.content.split(":");
        try {
          await message.channel.send(
            `<@716390085896962058> c ${pokemonName.trim()}`,
          );
        } catch {
          console.log(chalk.red("AI catch attempt failed"));
        }
      }
    }

    // --- HINT MODE (Pokétwo) ---
    if (catchMode === "hint" && message?.author.id === "716390085896962058") {
      if (message.embeds[0]?.title?.includes("wild pokémon has appeared")) {
        message.channel.send("<@716390085896962058> h");
      } else if (message?.content.includes("The pokémon is")) {
        const pokemon = await solveHint(message);
        if (pokemon[0]) {
          await message.channel.send("<@716390085896962058> c " + pokemon[0]);
        }
      }
    }

    // --- Quest Completion Detection ---
    if (
      message?.content?.includes("You have completed the quest") &&
      message?.content?.includes("Pokécoins")
    ) {
      // ✅ Clean message: remove markdown and trim
      const cleanMessage = message.content.replace(/\*\*/g, "").trim();

      // --- Region quest ---
      const questMatchRegion = cleanMessage.match(
        /Catch \d+ pokémon originally found in the (.+?) region\./i,
      );

      // --- Type quest ---
      const questMatchType = cleanMessage.match(
        /Catch \d+ .*?([A-Za-z]+)-type pokémon\./i,
      );

      // --- Coins (supports commas: 2,000 → 2000)
      const coinsText = cleanMessage.match(/received ([0-9,]+) Pokécoins/i);

      if (!coinsText?.[1]) {
        console.error(
          "❌ Could not parse Pokécoins from quest message:",
          cleanMessage,
        );
        return;
      }

      const coins = parseInt(coinsText[1].replace(/,/g, ""), 10);

      const quest =
        (questMatchRegion && `${questMatchRegion[1]} Region`) ||
        (questMatchType && `${questMatchType[1]}-type`) ||
        "Unknown Quest";

      // --- Update stats with quest Pokécoins ---
      updateStats(client, null, false, false, coins);

      // --- Quest Webhook ---
      const embed = {
        color: 0x00bcd4, // Cyan for quests
        description:
          `**Pookie :** ${client.user.username}\n` +
          `**Quest :** ${quest}\n` +
          `**Reward :** +${coins} Pokécoins`,
        footer: { text: "Developed by @ryomen.leo" },
        timestamp: new Date(),
      };

      try {
        await axios.post(webhookUrls.quest, {
          username: "LeO Pokecatcher Quests",
          avatar_url:
            "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/exp-share.png",
          embeds: [embed],
        });
        console.log(
          chalk.cyan(
            `[${date.format(new Date(), "YYYY-MM-DD HH:mm:ss")}] Quest Completed → ${quest} (+${coins} Pokécoins)`,
          ),
        );
      } catch (err) {
        console.error(
          chalk.red("❌ Failed to send quest webhook: " + err.message),
        );
      }
    }

    // --- Catch Confirmation ---
    if (
      message?.author.id === "716390085896962058" &&
      message?.content.startsWith("Congratulations <@" + client.user.id + ">")
    ) {
      const content = message.content;

      const levelMatch = content.match(/Level (\d+)/);
      const nameMatch = content.match(/Level \d+ ([^(<]+)/);
      const genderMatch = content.match(/<:([^:]+):\d+>/);
      const ivMatch = content.match(/\(([\d.]+)%\)/);
      const coinsMatch = content.match(/You received (\d+) Pokécoins/);

      const level = levelMatch ? levelMatch[1] : "?";
      const pokemonName = nameMatch ? nameMatch[1].trim() : "Unknown";
      const iv = ivMatch ? ivMatch[1] : "?";
      const coins = coinsMatch ? parseInt(coinsMatch[1]) : 0;

      let gender = genderEmojis.unknown;
      if (genderMatch) {
        if (genderMatch[1].toLowerCase().includes("male"))
          gender = genderEmojis.male;
        else if (genderMatch[1].toLowerCase().includes("female"))
          gender = genderEmojis.female;
      }

      const shiny = content.includes("✨");
      const gigantamax = content.includes("Gigantamax");

      let rarity = "Regular";
      try {
        rarity = await checkRarity(pokemonName.toLowerCase());
      } catch {
        rarity = "Regular";
      }

      // --- Update stats for catches ---
      updateStats(client, rarity, shiny, gigantamax, coins);

      let imageUrl = null;
      try {
        imageUrl = await getImage(pokemonName, shiny, gigantamax);
      } catch {
        imageUrl = null;
      }

      let webhook = webhookUrls.regular;
      let colorPalette = rarityColors.regular;
      if (shiny) {
        webhook = webhookUrls.shiny;
        colorPalette = rarityColors.shiny;
      } else if (gigantamax) {
        webhook = webhookUrls.gigantamax;
        colorPalette = rarityColors.gigantamax;
      } else if (rarity.toLowerCase() !== "regular") {
        webhook = webhookUrls.rare;
        colorPalette = rarityColors.rare;
      }

      const embedColor = getRandomColor(colorPalette);
      const timestamp = date.format(new Date(), "YYYY-MM-DD HH:mm:ss");

      let logMsg = `[${timestamp}] caught ${pokemonName} (${iv}% IV | Lvl ${level} | ${rarity} | ${gender}`;
      if (shiny) logMsg += " | ✨ Shiny";
      if (gigantamax) logMsg += " | Gigantamax";
      if (coins) logMsg += ` | +${coins} Pokécoins)`;
      else logMsg += ` )`;
      console.log(chalk.green(logMsg));

      const embed = {
        color: embedColor,
        fields: [], // ✅ FIX: initialize fields
        description:
          `**Pookie :** ${client.user.username}\n` +
          `**Pokémon :** ${pokemonName}\n` +
          `**IV :** ${iv}%\n` +
          `**Level :** ${level}\n` +
          `**Rarity :** ${rarity}\n` +
          `**Gender :** ${gender}` +
          (coins ? `\n**Pokécoins :** +${coins}` : ""),
        footer: { text: "Developed by @ryomen.leo" },
        timestamp: new Date(),
      };
      if (imageUrl) embed.thumbnail = { url: imageUrl };

      try {
        await axios.post(webhook, {
          username: "LeO Pokecatcher Logs",
          avatar_url:
            "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png",
          embeds: [embed],
        });
      } catch (err) {
        console.error(
          chalk.red("❌ Failed to send catch webhook: " + err.message),
        );
      }
    }
  });
};
