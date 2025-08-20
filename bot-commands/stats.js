const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

module.exports = {
  name: "stats",
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("📊 Show Pokecatcher stats"),

  async execute(ctx) {
    const isSlash = !!ctx.isChatInputCommand;
    const reply = async (options) =>
      isSlash ? ctx.reply(options) : ctx.reply(options);

    const statsPath = path.join(__dirname, "../data/stats.json");
    if (!fs.existsSync(statsPath)) {
      return reply({
        content: "⚠️ No stats available yet.",
        ephemeral: isSlash,
      });
    }

    const stats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
    const clients = Object.values(stats);

    if (clients.length === 0) {
      return reply({
        content: "⚠️ No clients are currently tracked.",
        ephemeral: isSlash,
      });
    }

    // --- Totals ---
    const totalCoins = clients.reduce((a, c) => a + (c.pokecoins || 0), 0);
    const totalCatches = clients.reduce(
      (a, c) => a + Object.values(c.catches || {}).reduce((x, y) => x + y, 0),
      0,
    );

    // --- Pre-format values ---
    const formatted = clients.map((c) => {
      const catches = Object.values(c.catches || {}).reduce((x, y) => x + y, 0);
      return {
        username: c.username,
        coins: c.pokecoins.toLocaleString(),
        catches: catches.toLocaleString(),
      };
    });

    // --- Column widths ---
    const maxUser = Math.max(
      ...formatted.map((c) => c.username.length),
      "Client Name".length,
    );
    const maxCoins = Math.max(
      ...formatted.map((c) => c.coins.length),
      "Pokécoins".length,
    );
    const maxCatch = Math.max(
      ...formatted.map((c) => c.catches.length),
      "Pokémons".length,
    );

    // --- Table ---
    let rows = `**${"Client Name".padEnd(maxUser)} | ${"Pokécoins".padEnd(maxCoins)} | ${"Pokémons".padEnd(maxCatch)}**\n`;

    for (const c of formatted) {
      rows += `${c.username.padEnd(maxUser)} | ${c.coins.padStart(maxCoins)} | ${c.catches.padStart(maxCatch)}\n`;

      if (rows.length > 3500) {
        rows += "... (more clients omitted)";
        break;
      }
    }

    // --- Main Embed ---
    const embed = new EmbedBuilder()
      .setTitle("📊 Leo Pokecatcher Stats")
      .setColor("Random")
      .setDescription(
        `**Total Clients:** ${clients.length}\n` +
          `**Total Pokécoins:** ${totalCoins.toLocaleString()}\n` +
          `**Total Pokémons Caught:** ${totalCatches.toLocaleString()}\n\n` +
          rows,
      )
      .setFooter({ text: "Developed by @ryomen.leo" })
      .setTimestamp();

    // --- Dropdown menu & pagination ---
    const buildMenu = (page) => {
      const start = page * 25;
      const slice = clients.slice(start, start + 25);
      const options = slice.map((c) => {
        const catches = Object.values(c.catches || {}).reduce(
          (x, y) => x + y,
          0,
        );
        return {
          label: c.username,
          description: `Pokécoins: ${c.pokecoins.toLocaleString()} | Pokémons: ${catches.toLocaleString()}`,
          value: c.username,
        };
      });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`statsMenu_${page}`)
        .setPlaceholder(`📂 Page ${page + 1}/${Math.ceil(clients.length / 25)}`)
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(menu);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prevPage")
          .setLabel("⬅️ Prev")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId("nextPage")
          .setLabel("➡️ Next")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(start + 25 >= clients.length),
      );

      return [row, buttons];
    };

    let currentPage = 0;
    const components = buildMenu(currentPage);

    const sent = await reply({ embeds: [embed], components });

    const collector = (isSlash ? sent : sent).createMessageComponentCollector({
      filter: (i) => i.user.id === (isSlash ? ctx.user.id : ctx.author.id),
      time: 120000,
    });

    collector.on("collect", async (interaction) => {
      if (interaction.customId.startsWith("statsMenu")) {
        const clientName = interaction.values[0];
        const client = clients.find((c) => c.username === clientName);

        if (!client) {
          return interaction.reply({
            content: "⚠️ Client not found.",
            ephemeral: true,
          });
        }

        const catches =
          Object.entries(client.catches || {})
            .map(([rarity, count]) => `${rarity}: ${count.toLocaleString()}`)
            .join("\n") || "None";

        const detailEmbed = new EmbedBuilder()
          .setTitle(`📂 Stats for ${client.username}`)
          .setColor("Blue")
          .addFields(
            {
              name: "Pokécoins",
              value: client.pokecoins.toLocaleString(),
              inline: true,
            },
            {
              name: "Total Pokémon Caught",
              value: Object.values(client.catches || {})
                .reduce((x, y) => x + y, 0)
                .toLocaleString(),
              inline: true,
            },
            { name: "Breakdown", value: catches },
          )
          .setFooter({ text: "Developed by @ryomen.leo" })
          .setTimestamp();

        await interaction.reply({ embeds: [detailEmbed], ephemeral: true });
      } else if (interaction.customId === "prevPage") {
        currentPage--;
        await sent.edit({ components: buildMenu(currentPage) });
        await interaction.deferUpdate();
      } else if (interaction.customId === "nextPage") {
        currentPage++;
        await sent.edit({ components: buildMenu(currentPage) });
        await interaction.deferUpdate();
      }
    });

    collector.on("end", async () => {
      try {
        await sent.edit({ components: [] });
      } catch {}
    });
  },
};
