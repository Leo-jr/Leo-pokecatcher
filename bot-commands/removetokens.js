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

    // Pagination variables
    const clientsPerPage = 25;
    const totalClients = global.selfClients.length;
    const totalPages = Math.ceil(totalClients / clientsPerPage);

    let currentPage = 0;

    function getOptions(page) {
      return global.selfClients
        .slice(page * clientsPerPage, (page + 1) * clientsPerPage)
        .map((c, i) => ({
          label: c.user?.tag || `Unknown-${page * clientsPerPage + i}`,
          description: `Token index ${page * clientsPerPage + i + 1}`,
          value: (page * clientsPerPage + i).toString(),
        }));
    }

    function getComponents(page) {
      const options = getOptions(page);

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`removeTokenMenu-${page}`)
        .setPlaceholder("Select client(s) to remove")
        .addOptions(options)
        .setMinValues(1)
        .setMaxValues(options.length);

      const rows = [new ActionRowBuilder().addComponents(menu)];

      // Pagination controls if necessary
      if (totalPages > 1) {
        const paginationButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("prevPage")
            .setLabel("⬅️ Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId("nextPage")
            .setLabel("➡️ Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1),
        );
        rows.push(paginationButtons);
      }

      // Remove All button
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("removeAllTokens")
            .setLabel("🗑️ Remove All Clients")
            .setStyle(ButtonStyle.Danger),
        )
      );

      return rows;
    }

    async function updatePage(interaction, page) {
      currentPage = page;
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("🗑️ Remove Selfbot Tokens")
            .setDescription(
              `Select one or more clients to remove from the dropdown, or click **Remove All Clients**.\n\n**Page ${page + 1} of ${totalPages}**`
            )
            .setColor("Red"),
        ],
        components: getComponents(page),
      });
    }

    // Initial embed and component send
    const sent = await reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🗑️ Remove Selfbot Tokens")
          .setDescription(
            `Select one or more clients to remove from the dropdown, or click **Remove All Clients**.\n\n**Page 1 of ${totalPages}**`
          )
          .setColor("Red"),
      ],
      components: getComponents(0),
      fetchReply: true,
    });

    const collector = sent.createMessageComponentCollector({
      filter: (i) => i.user.id === (isSlash ? ctx.user.id : ctx.author.id),
      time: 60000,
    });

    collector.on("collect", async (interaction) => {
      const tokenPath = path.join(__dirname, "../tokens.txt");
      const statsPath = path.join(__dirname, "../data/stats.json");
      let stats = {};
      if (fs.existsSync(statsPath)) {
        stats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
      }

      // Pagination
      if (interaction.customId === "prevPage") {
        await updatePage(interaction, currentPage - 1);
        return;
      }
      if (interaction.customId === "nextPage") {
        await updatePage(interaction, currentPage + 1);
        return;
      }

      // --- Multi-select removal (with page identification) ---
      if (interaction.customId.startsWith("removeTokenMenu")) {
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
        return;
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
        
        // Create a new collector for the confirmation buttons
        const confirmCollector = interaction.channel.createMessageComponentCollector({
          filter: (i) => i.user.id === interaction.user.id && (i.customId === "confirmRemoveAll" || i.customId === "cancelRemoveAll"),
          time: 30000,
          max: 1,
        });

        confirmCollector.on("collect", async (confirmInteraction) => {
          if (confirmInteraction.customId === "confirmRemoveAll") {
            global.selfClients.forEach((c) => c.removeAllListeners());
            const removed = global.selfClients.map((c) => c.user?.tag || "Unknown");
            global.selfClients = [];
            fs.writeFileSync(tokenPath, "", "utf-8");
            fs.writeFileSync(statsPath, "{}", "utf-8");
            
            await confirmInteraction.update({
              content: `🗑️ Removed **all clients**: ${removed.join(", ")}`,
              components: [],
            });
            
            // Update the main message
            await sent.edit({
              content: "✅ All clients have been removed.",
              embeds: [],
              components: [],
            });
            
            collector.stop();
          } else if (confirmInteraction.customId === "cancelRemoveAll") {
            await confirmInteraction.update({
              content: "❌ Cancelled removal of all clients.",
              components: [],
            });
          }
        });

        confirmCollector.on("end", async (collected) => {
          if (collected.size === 0) {
            try {
              await interaction.editReply({
                content: "⏱️ Confirmation timed out. No clients were removed.",
                components: [],
              });
            } catch (err) {
              console.error("Error editing timed out reply:", err);
            }
          }
        });
        
        return;
      }
    });

    collector.on("end", async () => {
      try {
        await sent.edit({ components: [] });
      } catch {}
    });
  },
};
