const fs = require("fs");
const path = require("path");
const { SlashCommandBuilder, MessageFlags } = require("discord.js");

// Supported webhook types including quest (excluding questCompleted etc.)
const webhookTypes = ["captcha", "regular", "rare", "shiny", "gigantamax", "quest"];

// Root directory path for config.js
const configFilePath = path.join(__dirname, "..", "config.js");

module.exports = {
  name: "createwebhooks",
  description: "Batch create webhook channels and update config.js URLs",
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName("createwebhooks")
    .setDescription("Create webhook channels for supported types and update config.js"),

  async execute(context, argsOrBot, maybeBot) {
    const message = context.isChatInputCommand ? null : context;
    const interaction = context.isChatInputCommand ? context : null;
    const bot = message ? maybeBot : argsOrBot;
    const guild = (message || interaction).guild;

    // Load config.js as object using require after clearing cache
    let configObj;
    try {
      delete require.cache[require.resolve(configFilePath)];
      configObj = require(configFilePath);
      console.log("✅ Loaded config.js object");
    } catch (err) {
      console.error("❌ Failed to load config.js:", err);
      return sendReply(message, interaction, `❌ Failed to load config.js: ${err.message}`);
    }

    // Ensure webhookUrls field exists
    if (!configObj.webhookUrls || typeof configObj.webhookUrls !== "object") {
      configObj.webhookUrls = {};
    }

    const results = [];

    // Create/update webhooks & URLs in memory
    for (const type of webhookTypes) {
      const channelName = type; // Only the type name, no "webhook-channel" suffix
      try {
        const channel = await guild.channels.create({
          name: channelName,
          type: 0 // Text channel (discord.js v14+)
        });

        const webhook = await channel.createWebhook({
          name: `${type}-webhook`
        });

        const url = `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`;

        // Update or add webhook URL in config object
        configObj.webhookUrls[type] = url;
        results.push(`✅ ${type}: Created channel <#${channel.id}> and updated webhook URL`);
      } catch (err) {
        console.error(`❌ Error for ${type}:`, err);
        results.push(`❌ ${type}: ${err.message}`);
      }
    }

    // Read original config.js text to preserve formatting, comments, functions etc.
    let originalText;
    try {
      originalText = fs.readFileSync(configFilePath, "utf8");
    } catch (err) {
      console.error("❌ Failed to read original config.js:", err);
      return sendReply(message, interaction, `❌ Failed to read config.js for writing: ${err.message}`);
    }

    // Serialize updated webhookUrls object to code string (with indentation)
    // We'll replace the whole webhookUrls object code block inside config.js
    // Find existing webhookUrls object block for replacement
    const webhookUrlsRegex = /webhookUrls\s*:\s*{[^}]*}/m;
    const formattedWebhookUrlsString = formatObjectLiteral(configObj.webhookUrls, 2);

    let newConfigText;
    if (webhookUrlsRegex.test(originalText)) {
      newConfigText = originalText.replace(webhookUrlsRegex, `webhookUrls: ${formattedWebhookUrlsString}`);
    } else {
      // webhookUrls block not found - insert before last closing brace if possible
      const insertPosition = originalText.lastIndexOf("}");
      if (insertPosition !== -1) {
        newConfigText =
          originalText.slice(0, insertPosition) +
          `,\n  webhookUrls: ${formattedWebhookUrlsString}\n` +
          originalText.slice(insertPosition);
      } else {
        // fallback: append at end
        newConfigText =
          originalText + `\n\n// Added webhookUrls\nwebhookUrls: ${formattedWebhookUrlsString}\n`;
      }
    }

    // Write updated config.js back
    try {
      fs.writeFileSync(configFilePath, newConfigText, "utf8");
      console.log("✅ Updated config.js with new webhook URLs");
    } catch (err) {
      console.error("❌ Failed to write updated config.js:", err);
      results.push(`❌ Failed to write updated config.js: ${err.message}`);
    }

    // Send results to user
    sendReply(message, interaction, results.join("\n"));
  }
};

// Helper: Format object literal as JavaScript code string with indentation
function formatObjectLiteral(obj, indentLevel = 2) {
  const indent = " ".repeat(indentLevel * 2);
  const entries = Object.entries(obj)
    .map(([k, v]) => `${indent}${k}: "${v}"`)
    .join(",\n");
  return `{\n${entries}\n${" ".repeat((indentLevel - 1) * 2)}}`;
}

// Reply handler to support prefix or slash commands and handle ephemeral flag properly
function sendReply(msg, interaction, text) {
  if (msg) {
    msg.reply(text).catch(console.error);
  } else if (interaction) {
    if (!interaction.deferred && !interaction.replied) {
      interaction
        .reply({ content: text, flags: MessageFlags.Ephemeral })
        .catch(console.error);
    } else if (interaction.followUp) {
      interaction
        .followUp({ content: text, flags: MessageFlags.Ephemeral })
        .catch(console.error);
    } else {
      console.error("Cannot reply to interaction multiple times");
    }
  }
}
