const {
  Client: BotClient,
  GatewayIntentBits,
  REST,
  Routes,
} = require("discord.js");
const fs = require("fs");
const chalk = require("chalk");
const config = require("./config.js");

// Import selfbot manager
const { loadSelfCommands, loadSelfbots } = require("./selfbots");

// ============================================================
// ---------------------- NORMAL BOT CLIENT -------------------
// ============================================================

const bot = new BotClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Bot commands (prefix + slash unified)
const botCommands = new Map();
function loadBotCommands() {
  if (!fs.existsSync("./bot-commands")) return;
  const commandFiles = fs
    .readdirSync("./bot-commands")
    .filter((f) => f.endsWith(".js"));
  for (const file of commandFiles) {
    const command = require(`./bot-commands/${file}`);
    botCommands.set(command.name, command);
    console.log(chalk.green(`Loaded bot command: ${command.name}`));
  }
}

// Register slash commands globally
async function registerSlashCommands(bot) {
  const rest = new REST({ version: "10" }).setToken(config.botToken);
  const slashDefs = Array.from(botCommands.values())
    .filter((c) => c.data)
    .map((c) => c.data.toJSON());

  try {
    console.log("🔄 Registering slash commands...");
    await rest.put(Routes.applicationCommands(bot.user.id), {
      body: slashDefs,
    });
    console.log("✅ Slash commands registered.");
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err);
  }
}

bot.once("ready", async () => {
  console.log(`🤖 Bot logged in as ${chalk.green(bot.user.tag)}`);
  await registerSlashCommands(bot);
});

// --- PREFIX HANDLER ---
bot.on("messageCreate", async (message) => {
  if (!message.content.startsWith(config.prefix) || message.author.bot) return;

  const args = message.content.slice(config.prefix.length).trim().split(/\s+/);
  const cmdName = args.shift().toLowerCase();

  const command = botCommands.get(cmdName);
  if (!command) return;

  if (command.ownerOnly && !config.isOwner(message.author.id)) {
    return message.reply("❌ You do not have permission to use this command.");
  }

  try {
    await command.execute(message, args, bot);
  } catch (err) {
    console.error(
      chalk.red(`Error executing bot command ${cmdName}: ${err.message}`),
    );
    message.reply("⚠️ There was an error executing that command.");
  }
});

// --- SLASH HANDLER ---
bot.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = botCommands.get(interaction.commandName);
  if (!command) return;

  if (command.ownerOnly && !config.isOwner(interaction.user.id)) {
    return interaction.reply({
      content: "❌ You do not have permission.",
      ephemeral: true,
    });
  }

  try {
    await command.execute(interaction, bot);
  } catch (err) {
    console.error(`❌ Error in /${interaction.commandName}:`, err);
    if (!interaction.replied) {
      await interaction.reply({
        content: "⚠️ Command failed.",
        ephemeral: true,
      });
    }
  }
});

// ============================================================
// ---------------------- START EVERYTHING --------------------
// ============================================================

// Load commands
loadSelfCommands();
loadBotCommands();

// Start all selfbots (from tokens.txt)
loadSelfbots();

// Start normal bot
if (config.botToken) {
  bot
    .login(config.botToken)
    .catch((err) => console.error("Bot login failed:", err.message));
} else {
  console.warn("⚠️ No botToken found in config.js");
}
