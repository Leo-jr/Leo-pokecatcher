const { Client: SelfClient } = require("discord.js-selfbot-v13");
const fs = require("fs");
const chalk = require("chalk");
const config = require("./config.js");

// Selfbot commands
const selfCommands = new Map();
function loadSelfCommands() {
  if (!fs.existsSync("./commands")) return;
  const commandFiles = fs
    .readdirSync("./commands")
    .filter((f) => f.endsWith(".js"));
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    selfCommands.set(command.name, command);
    console.log(chalk.blue(`Loaded selfbot command: ${command.name}`));
  }
}

// Selfbot events
function loadEvents(client) {
  if (!fs.existsSync("./events")) return;
  const eventFiles = fs
    .readdirSync("./events")
    .filter((f) => f.endsWith(".js"));
  for (const file of eventFiles) {
    const event = require(`./events/${file}`);
    event(client);
  }
}

// Login a selfbot
async function loginSelfbot(token) {
  const client = new SelfClient({ checkUpdate: false, readyStatus: false });
  client.token = token;

  client.on("ready", () => {
    console.log(`🔑 Selfbot logged in as ${chalk.green(client.user.tag)}`);
    client.user.setStatus("invisible");
  });

  if (!global.selfClients) global.selfClients = [];
  global.selfClients.push(client);

  client.on("messageCreate", async (message) => {
    if (!message.content.startsWith(config.prefix)) return;
    const args = message.content
      .slice(config.prefix.length)
      .trim()
      .split(/\s+/);
    const cmdName = args.shift().toLowerCase();

    const command = selfCommands.get(cmdName);
    if (!command) return;

    if (command.ownerOnly && !config.isOwner(message.author.id)) {
      return message.reply(
        "❌ You do not have permission to use this command.",
      );
    }

    try {
      await command.execute(message, args, client);
    } catch (err) {
      console.error(
        chalk.red(`Error executing selfbot command ${cmdName}: ${err.message}`),
      );
    }
  });

  loadEvents(client);

  try {
    await client.login(token);
    return client;
  } catch (err) {
    console.error("❌ Selfbot login failed:", err);
    return null;
  }
}

// Load tokens from tokens.txt and login them all
function loadSelfbots() {
  if (!fs.existsSync("./tokens.txt")) {
    console.warn("⚠️ No tokens.txt found. Skipping selfbots.");
    return;
  }

  const data = fs.readFileSync("./tokens.txt", "utf-8").trim();
  if (!data) {
    console.warn("⚠️ tokens.txt is empty.");
    return;
  }

  const tokens = data
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const token of tokens) {
    loginSelfbot(token);
  }
}

// Export for bot commands like addtokens
module.exports = { loginSelfbot, loadSelfCommands, loadSelfbots };
