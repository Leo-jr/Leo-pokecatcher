// index.js
const { Client } = require("discord.js-selfbot-v13");
const fs = require("fs");
const chalk = require("chalk");
const config = require("./config.js");

// Load tokens
let data = process.env.TOKENS || fs.readFileSync("./tokens.txt", "utf-8");
if (!data) throw new Error("Unable to find your tokens.");
const tokens = data
  .split(/\s+/)
  .map((t) => t.trim())
  .filter(Boolean);

// Command collection
const commands = new Map();
function loadCommands() {
  const commandFiles = fs
    .readdirSync("./commands")
    .filter((f) => f.endsWith(".js"));
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.set(command.name, command);
    console.log(chalk.blue(`Loaded command: ${command.name}`));
  }
}

// Event loader
function loadEvents(client) {
  const eventFiles = fs
    .readdirSync("./events")
    .filter((f) => f.endsWith(".js"));
  for (const file of eventFiles) {
    const event = require(`./events/${file}`);
    event(client);
  }
}

// Login client
async function loginClient(token) {
  const client = new Client({ checkUpdate: false, readyStatus: false });

  client.on("ready", () => {
    console.log(`Logged in as ${chalk.green(client.user.tag)}`);
    client.user.setStatus("invisible");
  });

  // Command handler
  client.on("messageCreate", async (message) => {
    if (!message.content.startsWith(config.prefix)) return; // use prefix from config
    const args = message.content
      .slice(config.prefix.length)
      .trim()
      .split(/\s+/);
    const cmdName = args.shift().toLowerCase();

    const command = commands.get(cmdName);
    if (!command) return;

    // Owner-only check
    if (command.ownerOnly && !config.isOwner(message.author.id)) {
      return message.reply(
        "❌ You do not have permission to use this command.",
      );
    }

    try {
      await command.execute(message, args);
    } catch (err) {
      console.error(chalk.red(`Error executing ${cmdName}: ${err.message}`));
      message.reply("⚠️ There was an error executing that command.");
    }
  });

  loadEvents(client);
  client.login(token).catch((err) => console.error("Login failed:", err));
}

// Load all commands once
loadCommands();

// Login all clients
for (const token of tokens) {
  loginClient(token);
}
