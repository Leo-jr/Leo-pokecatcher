const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

module.exports = {
  name: "removetokens",
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName("removetokens")
    .setDescription("🗑️ Remove selfbot tokens via dropdown or remove all"),

  async execute(ctx) {
    const isSlash = !!ctx.isChatInputCommand;
    const reply = async (options) =>
      isSlash ? ctx.reply(options) : ctx.reply(options);

    if (!global.selfClients || global.selfClients.length === 0) {
      return reply({
        content: "⚠️ No selfbot clients are active.",
        ephemeral: isSlash,
      });
    }

    const options = global.selfClients.map((c, i) => ({
      label: c.user?.tag || `Unknown-${i}`,
      description: `Token index ${i + 1}`,
      value: i.toString(),
    }));

    const menu = new StringSelectMenuBuilder()
      .setCustomId("removeTokenMenu")
      .setPlaceholder("Select client(s) to remove")
      .addOptions(options)
      .setMinValues(1)
      .setMaxValues(options.length);

    const row = new ActionRowBuilder().addComponents(menu);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("removeAllTokens")
        .setLabel("🗑️ Remove All Clients")
        .setStyle(ButtonStyle.Danger),
    );

    const sent = await reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🗑️ Remove Selfbot Tokens")
          .setDescription(
            "Select one or more clients to remove from the dropdown, or click **Remove All Clients**.",
          )
          .setColor("Red"),
      ],
      components: [row, buttons],
    });

    const collector = (isSlash ? sent : sent).createMessageComponentCollector({
      filter: (i) => i.user.id === (isSlash ? ctx.user.id : ctx.author.id),
      time: 60000,
    });

    collector.on("collect", async (interaction) => {
      const tokenPath = path.join(__dirname, "../tokens.txt");
      const statsPath = path.join(__dirname, "../data/stats.json");

      // Load stats.json
      let stats = {};
      if (fs.existsSync(statsPath)) {
        stats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
      }

      // --- Multi-select removal ---
      if (interaction.customId === "removeTokenMenu") {
        const indices = interaction.values.map((v) => parseInt(v));
        const removedClients = [];

        let tokens = fs
          .readFileSync(tokenPath, "utf-8")
          .split(/\r?\n/)
          .map((t) => t.trim());

        for (const idx of indices.sort((a, b) => b - a)) {
          const client = global.selfClients[idx];
          if (!client) continue;

          client.removeAllListeners();
          removedClients.push(client.user?.tag || `Unknown-${idx}`);

          // Remove from tokens.txt
          tokens = tokens.filter((t) => t && t !== client.token);

          // Remove from stats.json
          if (client.user?.id && stats[client.user.id]) {
            delete stats[client.user.id];
          }

          // Remove from memory
          global.selfClients.splice(idx, 1);
        }

        fs.writeFileSync(tokenPath, tokens.join("\n"), "utf-8");
        fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), "utf-8");

        await interaction.reply({
          content: `✅ Removed clients: **${removedClients.join(", ")}**`,
          ephemeral: true,
        });
      }

      // --- Remove All confirmation ---
      if (interaction.customId === "removeAllTokens") {
        const confirmButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("confirmRemoveAll")
            .setLabel("✅ Yes, remove all")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("cancelRemoveAll")
            .setLabel("❌ Cancel")
            .setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({
          content:
            "⚠️ Are you sure you want to remove **all clients**? This will clear `tokens.txt` and stats.json too.",
          components: [confirmButtons],
          ephemeral: true,
        });
      }

      // --- Confirm remove all ---
      if (interaction.customId === "confirmRemoveAll") {
        global.selfClients.forEach((c) => c.removeAllListeners());
        const removed = global.selfClients.map((c) => c.user?.tag || "Unknown");

        global.selfClients = [];

        fs.writeFileSync(tokenPath, "", "utf-8");
        fs.writeFileSync(statsPath, "{}", "utf-8");

        await interaction.update({
          content: `🗑️ Removed **all clients**: ${removed.join(", ")}`,
          components: [],
        });
      }

      // --- Cancel remove all ---
      if (interaction.customId === "cancelRemoveAll") {
        await interaction.update({
          content: "❌ Cancelled removal of all clients.",
          components: [],
        });
      }
    });

    collector.on("end", async () => {
      try {
        await sent.edit({ components: [] });
      } catch {}
    });
  },
};
