const fs = require("fs");
const path = require("path");
const { SlashCommandBuilder } = require("discord.js");
const { loginSelfbot } = require("../selfbots");

const tokensFile = path.join(__dirname, "../tokens.txt");

module.exports = {
  name: "addtokens",
  description: "Add selfbot tokens and initialize them instantly",
  data: new SlashCommandBuilder()
    .setName("addtokens")
    .setDescription("Add new selfbot tokens")
    .addStringOption((option) =>
      option
        .setName("tokens")
        .setDescription("Tokens separated by space or newline")
        .setRequired(true),
    ),

  ownerOnly: true,

  async execute(ctx) {
    // ctx can be message (prefix) OR interaction (slash)
    const isSlash = !!ctx.isChatInputCommand;
    const input = isSlash
      ? ctx.options.getString("tokens")
      : ctx.content.split(/\s+/).slice(1).join(" ");

    const newTokens = input
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (newTokens.length === 0) {
      const reply = "❌ No valid tokens found.";
      return isSlash
        ? ctx.reply({ content: reply, ephemeral: true })
        : ctx.reply(reply);
    }

    // Load existing tokens (ignoring blank lines)
    let existing = [];
    if (fs.existsSync(tokensFile)) {
      existing = fs
        .readFileSync(tokensFile, "utf-8")
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean); // removes blank lines
    }

    const results = [];
    const updatedTokens = [...existing];

    for (const token of newTokens) {
      if (existing.includes(token)) {
        results.push(`⚠️ Token already saved (skipped) ...${token.slice(-6)}`);
        continue;
      }

      updatedTokens.push(token);
      try {
        const client = await loginSelfbot(token);
        if (client?.user) {
          results.push(`✅ Logged in as **${client.user.tag}**`);
        } else {
          results.push(`❌ Failed login for token ...${token.slice(-6)}`);
        }
      } catch (err) {
        results.push(
          `❌ Error with token ...${token.slice(-6)}: ${err.message}`,
        );
      }
    }

    // ✅ Always rewrite file compactly, no empty lines
    fs.writeFileSync(tokensFile, updatedTokens.join("\n"), "utf-8");

    const reply =
      results.length > 0 ? results.join("\n") : "⚠️ No new tokens were added.";
    return isSlash
      ? ctx.reply({ content: reply, ephemeral: true })
      : ctx.reply(reply);
  },
};
