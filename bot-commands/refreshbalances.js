// bot-commands/refreshbalances.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

const STATS_FILE = path.join(__dirname, "..", "data", "stats.json");

module.exports = {
  name: "refreshbalances",
  data: new SlashCommandBuilder()
    .setName("refreshbalances")
    .setDescription("Refresh PokéCoin balances for all selfbot tokens"),
  ownerOnly: true,

  async execute(messageOrInteraction, args, client) {
    const isSlash = messageOrInteraction.isCommand?.() || messageOrInteraction.isChatInputCommand?.();
    const reply = (opts) =>
      isSlash
        ? messageOrInteraction.reply(opts)
        : messageOrInteraction.reply(opts);

    // Load existing stats or create empty object
    let stats = {};
    try {
      if (fs.existsSync(STATS_FILE)) {
        stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
      }
    } catch (e) {
      console.error("Error reading stats.json:", e);
    }

    const clients = global.selfClients || [];
    if (!clients.length) {
      return reply("❌ No selfbot clients available.");
    }

    // Filter out clients with null/undefined user
    const validClients = clients.filter(c => c && c.user && c.user.id);
    if (validClients.length === 0) {
      return reply("❌ No valid selfbot clients found (all clients have null user data).");
    }

    if (validClients.length < clients.length) {
      console.warn(`⚠️ Filtered out ${clients.length - validClients.length} clients with null user data`);
    }

    // Real-time tracking data
    const trackingData = {
      total: validClients.length,
      completed: 0,
      success: 0,
      failed: 0,
      processing: 0,
      currentBatch: 0,
      totalBatches: 0,
      startTime: Date.now(),
      recentUpdates: [],
      balances: {},
      failedClients: [],
    };

    // Create real-time dashboard
    const createDashboard = (isComplete = false) => {
      const elapsed = ((Date.now() - trackingData.startTime) / 1000).toFixed(1);
      const rate = trackingData.completed > 0 
        ? (trackingData.completed / elapsed).toFixed(2) 
        : "0.00";
      const eta = trackingData.completed > 0 && !isComplete
        ? Math.ceil((trackingData.total - trackingData.completed) / (trackingData.completed / elapsed))
        : 0;

      // Progress bar
      const progressPercent = Math.floor((trackingData.completed / trackingData.total) * 100);
      const progressBarLength = 20;
      const filledBars = Math.floor((progressPercent / 100) * progressBarLength);
      const emptyBars = progressBarLength - filledBars;
      const progressBar = "█".repeat(filledBars) + "░".repeat(emptyBars);

      // Calculate totals
      const balanceValues = Object.values(trackingData.balances);
      const totalCoins = balanceValues.reduce((sum, val) => sum + val, 0);
      const avgCoins = balanceValues.length > 0 ? Math.floor(totalCoins / balanceValues.length) : 0;

      const embed = new EmbedBuilder()
        .setTitle(isComplete ? "✅ Balance Refresh Complete!" : "🔄 Real-Time Balance Dashboard")
        .setColor(isComplete 
          ? (trackingData.failed === 0 ? 0x2ecc71 : 0xf39c12) 
          : 0x3498db
        )
        .setDescription(
          isComplete
            ? `Successfully refreshed balances for **${trackingData.success}/${trackingData.total}** tokens!`
            : `Fetching balances in real-time...\n\`\`\`\n${progressBar} ${progressPercent}%\n\`\`\``
        )
        .addFields(
          { 
            name: "📊 Progress", 
            value: `**Completed:** ${trackingData.completed}/${trackingData.total}\n**Processing:** ${trackingData.processing}\n**In Queue:** ${trackingData.total - trackingData.completed}`,
            inline: true 
          },
          { 
            name: "📈 Results", 
            value: `**✅ Success:** ${trackingData.success}\n**❌ Failed:** ${trackingData.failed}\n**📉 Success Rate:** ${trackingData.completed > 0 ? ((trackingData.success / trackingData.completed) * 100).toFixed(1) : 0}%`,
            inline: true 
          },
          { 
            name: "⏱️ Performance", 
            value: `**Elapsed:** ${elapsed}s\n**Rate:** ${rate}/sec\n**ETA:** ${isComplete ? "Done!" : `${eta}s`}`,
            inline: true 
          }
        );

      if (!isComplete && trackingData.totalBatches > 0) {
        embed.addFields({
          name: "📦 Batch Progress",
          value: `Processing batch **${trackingData.currentBatch}/${trackingData.totalBatches}**`,
          inline: false
        });
      }

      // Recent updates (limited to prevent embed size issues)
      if (trackingData.recentUpdates.length > 0) {
        const recentText = trackingData.recentUpdates.slice(-8).join("\n");
        if (recentText.length < 1000) { // Discord limit check
          embed.addFields({
            name: "📝 Recent Updates",
            value: "``````",
            inline: false
          });
        }
      }

      // Balance statistics
      if (balanceValues.length > 0) {
        const highest = Math.max(...balanceValues);
        const lowest = Math.min(...balanceValues);
        
        embed.addFields({
          name: "💰 Balance Statistics",
          value: 
            `**Total PokéCoins:** ${totalCoins.toLocaleString()}\n` +
            `**Average:** ${avgCoins.toLocaleString()}\n` +
            `**Highest:** ${highest.toLocaleString()}\n` +
            `**Lowest:** ${lowest.toLocaleString()}`,
          inline: false
        });
      }

      // Top 5 live balances
      if (balanceValues.length > 0) {
        const topBalances = Object.entries(trackingData.balances)
          .map(([userId, balance]) => ({
            username: stats[userId]?.username || "Unknown",
            balance
          }))
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 5)
          .map((item, index) => `${index + 1}. **${item.username}**: ${item.balance.toLocaleString()} 💰`)
          .join("\n");

        embed.addFields({
          name: "🏆 Top 5 Balances (Live)",
          value: topBalances,
          inline: false
        });
      }

      embed.setFooter({ 
        text: isComplete 
          ? `Completed at ${new Date().toLocaleTimeString()}` 
          : `Live Updates • Last updated: ${new Date().toLocaleTimeString()}`
      });
      embed.setTimestamp();

      return embed;
    };

    // Send initial dashboard
    const dashboardMsg = await reply({ 
      embeds: [createDashboard()],
      fetchReply: true 
    });

    // Update dashboard throttle
    let lastUpdate = Date.now();
    const UPDATE_INTERVAL = 2000;

    const updateDashboard = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastUpdate < UPDATE_INTERVAL) return;
      
      try {
        await dashboardMsg.edit({ embeds: [createDashboard()] });
        lastUpdate = now;
      } catch (err) {
        console.error("Failed to update dashboard:", err.message);
      }
    };

    // Fetch balance for one client with retry logic
    async function fetchBalance(selfbot, retries = 3) {
      if (!selfbot || !selfbot.user || !selfbot.user.id) {
        throw new Error(`Invalid client: user data is null`);
      }

      const userId = selfbot.user.id;
      const tag = selfbot.user.tag || "Unknown";
      const username = selfbot.user.username || "Unknown";
      
      trackingData.processing++;
      trackingData.recentUpdates.push(`🔄 Fetching ${tag}...`);
      if (trackingData.recentUpdates.length > 8) trackingData.recentUpdates.shift();
      await updateDashboard();
      
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const guild = selfbot.guilds.cache.first();
          if (!guild) throw new Error(`no guild cached`);
          
          const channel = guild.channels.cache.find((ch) => {
            try {
              return ch.isText && ch.isText() && ["c", "catch", "general", "spam", "bot"].includes(ch.name.toLowerCase());
            } catch (err) {
              return false;
            }
          });
          
          if (!channel) throw new Error(`no suitable channel found`);

          const collectorPromise = channel.awaitMessages({
            filter: (m) =>
              m.author.id === "716390085896962058" &&
              m.embeds?.[0]?.fields?.some((f) => f.name === "Pokécoins"),
            max: 1,
            time: 15000,
          });

          await new Promise(resolve => setTimeout(resolve, 150));
          await channel.send("<@716390085896962058> balance");
          
          const collected = await collectorPromise;
          const embed = collected.first()?.embeds[0];
          if (!embed) throw new Error(`no balance response received`);
          
          const field = embed.fields.find((f) => f.name === "Pokécoins");
          if (!field) throw new Error(`Pokécoins field not found`);
          
          const balanceValue = field.value.replace(/[,\s]/g, "").match(/\d+/);
          if (!balanceValue) throw new Error(`could not parse balance`);
          
          const balance = parseInt(balanceValue[0]);
          if (isNaN(balance)) throw new Error(`invalid balance number`);
          
          trackingData.processing--;
          return { userId, tag, username, balance, success: true };
          
        } catch (error) {
          if (attempt < retries) {
            const retryDelay = 2000 * (attempt + 1);
            trackingData.recentUpdates.push(`⚠️ Retry ${attempt + 1}/${retries}: ${tag}`);
            if (trackingData.recentUpdates.length > 8) trackingData.recentUpdates.shift();
            await updateDashboard();
            
            console.log(`⚠️ Retry ${attempt + 1}/${retries} for ${tag}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            trackingData.processing--;
            throw new Error(`${tag}: ${error.message}`);
          }
        }
      }
    }

    // Process in batches
    const BATCH_SIZE = 5;
    const BATCH_DELAY = 3000;

    trackingData.totalBatches = Math.ceil(validClients.length / BATCH_SIZE);
    console.log(`Starting balance refresh for ${validClients.length} clients in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < validClients.length; i += BATCH_SIZE) {
      const batch = validClients.slice(i, i + BATCH_SIZE);
      trackingData.currentBatch = Math.floor(i / BATCH_SIZE) + 1;
      
      console.log(`Processing batch ${trackingData.currentBatch}/${trackingData.totalBatches}...`);
      await updateDashboard();

      const batchResults = await Promise.allSettled(
        batch.map((client) => fetchBalance(client))
      );

      for (const result of batchResults) {
        trackingData.completed++;
        
        if (result.status === "fulfilled") {
          const { userId, tag, username, balance } = result.value;
          
          if (!stats[userId]) {
            stats[userId] = {
              username: username || tag,
              catches: {},
              captcha: {
                detected: 0,
                solved: 0,
                failed: 0
              }
            };
          }
          
          stats[userId].pokecoins = balance;
          stats[userId].username = username || tag;
          stats[userId].lastBalanceUpdate = new Date().toISOString();
          
          trackingData.balances[userId] = balance;
          trackingData.success++;
          
          trackingData.recentUpdates.push(`✅ ${tag}: ${balance.toLocaleString()}`);
          if (trackingData.recentUpdates.length > 8) trackingData.recentUpdates.shift();
          
          console.log(`✅ [${trackingData.completed}/${trackingData.total}] ${tag}: ${balance.toLocaleString()} PokéCoins`);
        } else {
          trackingData.failed++;
          
          const failedClient = batch[batchResults.indexOf(result)];
          if (failedClient && failedClient.user) {
            trackingData.failedClients.push(failedClient);
          }
          
          trackingData.recentUpdates.push(`❌ ${result.reason.message}`);
          if (trackingData.recentUpdates.length > 8) trackingData.recentUpdates.shift();
          
          console.error(`❌ [${trackingData.completed}/${trackingData.total}] ${result.reason.message}`);
        }

        await updateDashboard();
      }

      if (i + BATCH_SIZE < validClients.length) {
        console.log(`Waiting ${BATCH_DELAY / 1000}s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }

    // Retry failed clients
    if (trackingData.failedClients.length > 0) {
      console.log(`\n🔄 Retrying ${trackingData.failedClients.length} failed clients...`);
      trackingData.recentUpdates.push(`🔄 Retrying ${trackingData.failedClients.length} failed...`);
      if (trackingData.recentUpdates.length > 8) trackingData.recentUpdates.shift();
      await updateDashboard();

      await new Promise(resolve => setTimeout(resolve, 3000));

      const retryResults = await Promise.allSettled(
        trackingData.failedClients.map((client) => fetchBalance(client, 2))
      );

      let retriedSuccess = 0;
      for (const result of retryResults) {
        if (result.status === "fulfilled") {
          const { userId, tag, username, balance } = result.value;
          
          if (!stats[userId]) {
            stats[userId] = {
              username: username || tag,
              catches: {},
              captcha: { detected: 0, solved: 0, failed: 0 }
            };
          }
          
          stats[userId].pokecoins = balance;
          stats[userId].username = username || tag;
          stats[userId].lastBalanceUpdate = new Date().toISOString();
          
          trackingData.balances[userId] = balance;
          trackingData.success++;
          trackingData.failed--;
          retriedSuccess++;
          
          trackingData.recentUpdates.push(`✅ Retry success: ${tag}`);
          if (trackingData.recentUpdates.length > 8) trackingData.recentUpdates.shift();
          
          console.log(`✅ Retry success: ${tag}: ${balance.toLocaleString()} PokéCoins`);
        }
      }

      console.log(`🔄 Retry complete: ${retriedSuccess}/${trackingData.failedClients.length} succeeded`);
      await updateDashboard();
    }

    // Save stats
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      console.log(`📁 Stats file updated with ${trackingData.success} balance updates`);
    } catch (e) {
      console.error("❌ Error writing stats.json:", e);
    }

    // Final update
    await updateDashboard(true);

    // Detailed breakdown with pagination for 1000+ clients
    setTimeout(async () => {
      try {
        const allBalances = Object.entries(trackingData.balances)
          .map(([userId, balance]) => ({
            userId,
            username: stats[userId]?.username || "Unknown",
            balance
          }))
          .sort((a, b) => b.balance - a.balance);

        if (allBalances.length === 0) {
          const noDataEmbed = new EmbedBuilder()
            .setTitle("📊 Detailed Balance Breakdown")
            .setDescription("❌ No balances were successfully fetched.")
            .setColor(0xe74c3c)
            .setTimestamp();
          
          return await dashboardMsg.reply({ embeds: [noDataEmbed] });
        }

        // Split into pages (10 per page to stay under embed limits)
        const itemsPerPage = 10;
        const totalPages = Math.ceil(allBalances.length / itemsPerPage);
        let currentPage = 0;

        const createDetailedEmbed = (page) => {
          const start = page * itemsPerPage;
          const end = start + itemsPerPage;
          const pageBalances = allBalances.slice(start, end);

          const embed = new EmbedBuilder()
            .setTitle("📊 Detailed Balance Breakdown")
            .setDescription(`Showing ${start + 1}-${Math.min(end, allBalances.length)} of ${allBalances.length} accounts`)
            .setColor(0x9b59b6);

          const balanceText = pageBalances
            .map((item, index) => 
              `${start + index + 1}. **${item.username}**: ${item.balance.toLocaleString()} 💰`
            )
            .join("\n");

          embed.addFields({
            name: `💰 Balances (Page ${page + 1}/${totalPages})`,
            value: balanceText,
            inline: false
          });

          // Summary on first page
          if (page === 0) {
            const totalCoins = allBalances.reduce((sum, item) => sum + item.balance, 0);
            const avgCoins = Math.floor(totalCoins / allBalances.length);
            embed.addFields({
              name: "📈 Summary",
              value: 
                `**Total Accounts:** ${allBalances.length}\n` +
                `**Total PokéCoins:** ${totalCoins.toLocaleString()}\n` +
                `**Average Balance:** ${avgCoins.toLocaleString()}`,
              inline: false
            });
          }

          embed.setFooter({ text: `Page ${page + 1} of ${totalPages}` });
          embed.setTimestamp();
          return embed;
        };

        const createButtons = (page) => {
          const buttons = [];

          // Previous button
          buttons.push(
            new ButtonBuilder()
              .setCustomId("prev_page")
              .setLabel("⬅️ Previous")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === 0)
          );

          // Next button
          buttons.push(
            new ButtonBuilder()
              .setCustomId("next_page")
              .setLabel("Next ➡️")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === totalPages - 1)
          );

          // Export button
          buttons.push(
            new ButtonBuilder()
              .setCustomId("export_balances")
              .setLabel("📥 Export")
              .setStyle(ButtonStyle.Primary)
          );

          // Statistics button
          buttons.push(
            new ButtonBuilder()
              .setCustomId("show_stats")
              .setLabel("📊 Stats")
              .setStyle(ButtonStyle.Success)
          );

          return new ActionRowBuilder().addComponents(buttons);
        };

        const detailMsg = await dashboardMsg.reply({ 
          embeds: [createDetailedEmbed(currentPage)],
          components: [createButtons(currentPage)]
        });

        // Button collector
        const collector = detailMsg.createMessageComponentCollector({
          time: 300000 // 5 minutes
        });

        collector.on("collect", async (interaction) => {
          try {
            if (interaction.customId === "prev_page") {
              currentPage = Math.max(0, currentPage - 1);
              await interaction.update({
                embeds: [createDetailedEmbed(currentPage)],
                components: [createButtons(currentPage)]
              });
            } else if (interaction.customId === "next_page") {
              currentPage = Math.min(totalPages - 1, currentPage + 1);
              await interaction.update({
                embeds: [createDetailedEmbed(currentPage)],
                components: [createButtons(currentPage)]
              });
            } else if (interaction.customId === "export_balances") {
              await interaction.deferReply({ ephemeral: true });

              // Create CSV content
              let csvContent = "Rank,Username,User ID,Balance (PokéCoins)\n";
              allBalances.forEach((item, index) => {
                csvContent += `${index + 1},"${item.username}",${item.userId},${item.balance}\n`;
              });

              const buffer = Buffer.from(csvContent, "utf-8");
              const attachment = new AttachmentBuilder(buffer, {
                name: `balances-${Date.now()}.csv`
              });

              await interaction.editReply({
                content: `✅ Exported **${allBalances.length}** balances to CSV file!`,
                files: [attachment]
              });
            } else if (interaction.customId === "show_stats") {
              await interaction.deferReply({ ephemeral: true });

              const totalCoins = allBalances.reduce((sum, item) => sum + item.balance, 0);
              const avgCoins = Math.floor(totalCoins / allBalances.length);
              const medianBalance = allBalances[Math.floor(allBalances.length / 2)].balance;
              const highest = allBalances[0];
              const lowest = allBalances[allBalances.length - 1];

              // Calculate distribution
              const ranges = [
                { label: "0-10K", min: 0, max: 10000, count: 0 },
                { label: "10K-50K", min: 10000, max: 50000, count: 0 },
                { label: "50K-100K", min: 50000, max: 100000, count: 0 },
                { label: "100K-500K", min: 100000, max: 500000, count: 0 },
                { label: "500K+", min: 500000, max: Infinity, count: 0 }
              ];

              allBalances.forEach(item => {
                for (const range of ranges) {
                  if (item.balance >= range.min && item.balance < range.max) {
                    range.count++;
                    break;
                  }
                }
              });

              const statsEmbed = new EmbedBuilder()
                .setTitle("📊 Balance Statistics")
                .setColor(0x3498db)
                .addFields(
                  {
                    name: "📈 Overview",
                    value: 
                      `**Total Accounts:** ${allBalances.length}\n` +
                      `**Total PokéCoins:** ${totalCoins.toLocaleString()}\n` +
                      `**Average Balance:** ${avgCoins.toLocaleString()}\n` +
                      `**Median Balance:** ${medianBalance.toLocaleString()}`,
                    inline: false
                  },
                  {
                    name: "🏆 Highest Balance",
                    value: `**${highest.username}**: ${highest.balance.toLocaleString()} 💰`,
                    inline: true
                  },
                  {
                    name: "📉 Lowest Balance",
                    value: `**${lowest.username}**: ${lowest.balance.toLocaleString()} 💰`,
                    inline: true
                  },
                  {
                    name: "📊 Distribution",
                    value: ranges.map(r => 
                      `**${r.label}:** ${r.count} accounts (${((r.count / allBalances.length) * 100).toFixed(1)}%)`
                    ).join("\n"),
                    inline: false
                  }
                )
                .setTimestamp();

              await interaction.editReply({ embeds: [statsEmbed] });
            }
          } catch (err) {
            console.error("Button interaction error:", err);
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({
                content: `❌ Error: ${err.message}`,
                ephemeral: true
              });
            }
          }
        });

        collector.on("end", () => {
          try {
            const disabledButtons = createButtons(currentPage);
            disabledButtons.components.forEach(btn => btn.setDisabled(true));
            detailMsg.edit({ components: [disabledButtons] }).catch(() => {});
          } catch (err) {
            console.error("Error disabling buttons:", err);
          }
        });

      } catch (err) {
        console.error("Failed to send detailed breakdown:", err);
      }
    }, 3000);
  },
};
