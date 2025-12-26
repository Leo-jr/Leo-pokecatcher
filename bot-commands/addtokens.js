const fs = require("fs");
const path = require("path");
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { loginSelfbot } = require("../selfbots");

const tokensFile = path.join(__dirname, "../tokens.txt");
const backupFile = path.join(__dirname, "../tokens.backup.txt");

// Discord token validation regex
const TOKEN_REGEX = /(?:mfa\.[a-z0-9_-]{20,})|(?:[a-z0-9_-]{23,28}\.[a-z0-9_-]{6,7}\.[a-z0-9_-]{27,38})/i;

// Error types for better categorization
const ERROR_TYPES = {
  INVALID_TOKEN: "Invalid token format",
  RATE_LIMITED: "Discord rate limit",
  NETWORK_ERROR: "Connection failed",
  TOKEN_BANNED: "Token banned/locked",
  TOKEN_DISABLED: "Account disabled",
  UNKNOWN: "Unknown error"
};

// Helper function to extract token from various formats
function extractToken(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Check if line contains colons (email:pass:token or email:token format)
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    
    // Format: email:pass:token or email:password:token (3+ parts)
    if (parts.length >= 3) {
      // Token is the last part
      const potentialToken = parts[parts.length - 1].trim();
      if (TOKEN_REGEX.test(potentialToken)) {
        return potentialToken;
      }
    }
    
    // Format: email:token (2 parts)
    if (parts.length === 2) {
      const potentialToken = parts[1].trim();
      if (TOKEN_REGEX.test(potentialToken)) {
        return potentialToken;
      }
    }
  }
  
  // Format: token only (no colons)
  if (TOKEN_REGEX.test(trimmed)) {
    return trimmed;
  }
  
  return null;
}

module.exports = {
  name: "addtokens",
  description: "Add selfbot tokens and initialize them instantly with advanced monitoring",
  data: new SlashCommandBuilder()
    .setName("addtokens")
    .setDescription("Add new selfbot tokens")
    .addStringOption((option) =>
      option
        .setName("tokens")
        .setDescription("Tokens separated by space or newline")
        .setRequired(false)
    )
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("Upload a .txt file containing tokens (one per line)")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("batch_size")
        .setDescription("Number of tokens to process simultaneously (1-5)")
        .setMinValue(1)
        .setMaxValue(5)
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("retry_attempts")
        .setDescription("Number of retry attempts for failed logins (1-5)")
        .setMinValue(1)
        .setMaxValue(5)
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName("public")
        .setDescription("Show progress publicly in channel (default: private)")
        .setRequired(false)
    )
    .addChannelOption((option) =>
      option
        .setName("log_channel")
        .setDescription("Channel to send token backup logs (optional)")
        .setRequired(false)
    ),
  ownerOnly: true,

  async execute(ctx) {
    const isSlash = !!ctx.isChatInputCommand;

    // Get batch size and retry attempts from options
    const BATCH_SIZE = isSlash ? (ctx.options.getInteger("batch_size") || 2) : 2;
    const MAX_RETRIES = isSlash ? (ctx.options.getInteger("retry_attempts") || 3) : 3;
    const isPublic = isSlash ? (ctx.options.getBoolean("public") || false) : true;
    const logChannel = isSlash ? ctx.options.getChannel("log_channel") : null;

    // Parse tokens from string input or file attachment
    let newTokens = [];

    if (isSlash) {
      const attachment = ctx.options.getAttachment("file");
      const stringInput = ctx.options.getString("tokens");

      if (attachment) {
        try {
          const response = await fetch(attachment.url);
          const fileContent = await response.text();
          const lines = fileContent.split(/[\r\n]+/);
          
          // Extract tokens from each line (supports email:pass:token, email:token, token)
          newTokens = lines
            .map(line => extractToken(line))
            .filter(Boolean);
        } catch (err) {
          return ctx.reply({
            content: `❌ Failed to read file: ${err.message}`,
            ephemeral: true
          });
        }
      } else if (stringInput) {
        // Handle both spaces and newlines in slash command input
        const lines = stringInput.split(/[\s\n\r]+/);
        newTokens = lines
          .map(line => extractToken(line))
          .filter(Boolean);
      } else {
        return ctx.reply({
          content: "❌ Please provide tokens via text input or file upload.",
          ephemeral: true
        });
      }
    } else {
      // Prefix command parsing - handle spaces and newlines
      const args = ctx.content.split(/\s+/).slice(1);
      const input = args.join(" ");

      if (!input) {
        return ctx.reply("❌ No valid tokens found. Usage: `!addtokens <token1> <token2> ...`");
      }

      // Split by spaces AND newlines (handles pasted text with newlines)
      const lines = input.split(/[\s\n\r]+/);
      newTokens = lines
        .map(line => extractToken(line))
        .filter(Boolean);

      if (newTokens.length === 0) {
        return ctx.reply("❌ No valid tokens found. Usage: `!addtokens <token1> <token2> ...`");
      }
    }

    if (newTokens.length === 0) {
      const reply = "❌ No valid tokens found.";
      return isSlash
        ? ctx.reply({ content: reply, ephemeral: true })
        : ctx.reply(reply);
    }

    // Load existing tokens
    let existing = [];
    if (fs.existsSync(tokensFile)) {
      existing = fs
        .readFileSync(tokensFile, "utf-8")
        .split(/[\r\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
    }

    // Create backup before modifying
    if (fs.existsSync(tokensFile)) {
      try {
        fs.copyFileSync(tokensFile, backupFile);
      } catch (err) {
        console.error("⚠️ Failed to create backup:", err);
      }
    }

    // Pre-validation summary
    const duplicates = newTokens.filter(t => existing.includes(t)).length;
    const invalidFormat = newTokens.filter(t => !TOKEN_REGEX.test(t)).length;
    const toProcess = newTokens.length - duplicates - invalidFormat;

    const validationEmbed = new EmbedBuilder()
      .setTitle("🔍 Token Validation Summary")
      .setColor(0x3498db)
      .addFields(
        { name: "📊 Total Tokens", value: `${newTokens.length}`, inline: true },
        { name: "🆕 New Tokens", value: `${toProcess}`, inline: true },
        { name: "⚠️ Duplicates", value: `${duplicates}`, inline: true },
        { name: "❌ Invalid Format", value: `${invalidFormat}`, inline: true },
        { name: "⚙️ Batch Size", value: `${BATCH_SIZE}`, inline: true },
        { name: "🔄 Max Retries", value: `${MAX_RETRIES}`, inline: true }
      )
      .setDescription(toProcess > 0 ? "✅ Ready to process tokens..." : "⚠️ No new valid tokens to add.")
      .setFooter({ text: "Processing will start automatically... | Supports: token, email:token, email:pass:token" })
      .setTimestamp();

    if (logChannel) {
      validationEmbed.addFields({
        name: "📝 Log Channel",
        value: `<#${logChannel.id}>`,
        inline: true
      });
    }

    // Send initial message and store it properly
    let dashboardMsg;
    try {
      if (isSlash) {
        await ctx.reply({ 
          embeds: [validationEmbed], 
          ephemeral: !isPublic,
          fetchReply: true
        });
        dashboardMsg = await ctx.fetchReply();
      } else {
        dashboardMsg = await ctx.reply({ embeds: [validationEmbed] });
      }
    } catch (err) {
      console.error("Failed to send initial message:", err);
      return;
    }

    if (toProcess === 0) {
      return;
    }

    // Wait 2 seconds before starting
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Results tracking with full token storage
    const results = {
      success: [],
      failed: [],
      skipped: [],
      invalid: [],
      retried: [],
      // Store actual tokens for bad ones
      badTokens: {
        invalid: [],
        duplicates: [],
        banned: [],
        disabled: [],
        failed: []
      },
      // Store working tokens with details
      workingTokens: []
    };

    const updatedTokens = [...existing];
    const statusLog = [];
    const startTime = Date.now();
    let processedCount = 0;

    // Helper function to update dashboard with detailed progress
    const updateDashboard = async (current, total, currentStatus, isComplete = false) => {
      const progressFilled = Math.floor((current / total) * 20);
      const progressBar = "█".repeat(progressFilled) + "░".repeat(20 - progressFilled);
      const percentage = Math.floor((current / total) * 100);

      // Calculate stats
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = current > 0 ? (current / elapsed).toFixed(2) : "0.00";
      const remaining = current > 0 ? Math.ceil((total - current) / (current / elapsed)) : 0;
      const etaText = remaining > 60 ? `${Math.floor(remaining / 60)}m ${remaining % 60}s` : `${remaining}s`;

      const color = isComplete
        ? results.failed.length === 0 ? 0x2ecc71 : results.success.length > 0 ? 0xf39c12 : 0xe74c3c
        : 0x3498db;

      const updatedEmbed = new EmbedBuilder()
        .setTitle(isComplete ? "✨ Token Addition Complete!" : "🔐 Token Addition Dashboard")
        .setColor(color)
        .setDescription(
          isComplete
            ? `Successfully processed **${current}/${total}** tokens!`
            : `Processing tokens... **${percentage}%** complete`
        )
        .addFields(
          { name: "📊 Total", value: `${total}`, inline: true },
          { name: "✅ Success", value: `${results.success.length}`, inline: true },
          { name: "❌ Failed", value: `${results.failed.length}`, inline: true },
          { name: "⚠️ Skipped", value: `${results.skipped.length}`, inline: true },
          { name: "🚫 Invalid", value: `${results.invalid.length}`, inline: true },
          { name: "🔄 Retried", value: `${results.retried.length}`, inline: true },
          {
            name: "⏳ Progress",
            value: `\`\`\`\n${progressBar} ${percentage}%\n\`\`\`\n${currentStatus}`,
            inline: false
          },
          {
            name: "⏱️ Performance Stats",
            value: `**Rate:** ${rate} tokens/sec\n**Elapsed:** ${elapsed.toFixed(1)}s\n**ETA:** ${isComplete ? "Done!" : etaText}`,
            inline: true
          },
          {
            name: "💾 Status",
            value: `**Processed:** ${current}/${total}\n**In Queue:** ${total - current}\n**Batch Size:** ${BATCH_SIZE}`,
            inline: true
          },
          {
            name: "📝 Recent Activity",
            value: `\`\`\`\n${statusLog.slice(-10).join("\n") || "No activity yet..."}\n\`\`\``,
            inline: false
          }
        )
        .setFooter({
          text: isComplete
            ? `Completed at ${new Date().toLocaleTimeString()}`
            : `Processing batch... | ${current}/${total} tokens`
        })
        .setTimestamp();

      try {
        if (isSlash) {
          await ctx.editReply({ embeds: [updatedEmbed] });
        } else {
          await dashboardMsg.edit({ embeds: [updatedEmbed] });
        }
      } catch (err) {
        console.error("Failed to update dashboard:", err.message);
      }
    };

    // Enhanced login with retry mechanism
    const loginWithRetry = async (token, tokenPreview) => {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          statusLog.push(
            attempt > 1
              ? `🔄 Retry ${attempt}/${MAX_RETRIES}: ${tokenPreview}`
              : `🔄 Logging in: ${tokenPreview}`
          );

          const client = await loginSelfbot(token);

          if (client?.user) {
            if (attempt > 1) {
              results.retried.push(tokenPreview);
            }
            return { success: true, client, userTag: client.user.tag, userId: client.user.id };
          } else {
            return { success: false, error: ERROR_TYPES.UNKNOWN };
          }
        } catch (err) {
          // Categorize error
          let errorType = ERROR_TYPES.UNKNOWN;
          const errMsg = err.message?.toLowerCase() || "";
          
          if (errMsg.includes("rate limit") || errMsg.includes("429")) {
            errorType = ERROR_TYPES.RATE_LIMITED;
          } else if (errMsg.includes("401") || errMsg.includes("unauthorized") || errMsg.includes("token_invalid")) {
            errorType = ERROR_TYPES.TOKEN_BANNED;
          } else if (errMsg.includes("econnrefused") || errMsg.includes("enotfound") || errMsg.includes("etimedout")) {
            errorType = ERROR_TYPES.NETWORK_ERROR;
          } else if (errMsg.includes("disabled") || errMsg.includes("locked")) {
            errorType = ERROR_TYPES.TOKEN_DISABLED;
          }

          // Don't retry for banned/disabled tokens
          if (errorType === ERROR_TYPES.TOKEN_BANNED || errorType === ERROR_TYPES.TOKEN_DISABLED) {
            return { success: false, error: errorType, message: err.message, token };
          }

          if (attempt === MAX_RETRIES) {
            return { success: false, error: errorType, message: err.message, token };
          }

          // Exponential backoff for retries
          const delay = 2000 * Math.pow(1.5, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    };

    // Process tokens in batches
    statusLog.push(`🚀 Starting batch processing...`);
    await updateDashboard(0, newTokens.length, "Initializing batch processor...");

    for (let i = 0; i < newTokens.length; i += BATCH_SIZE) {
      const batch = newTokens.slice(i, Math.min(i + BATCH_SIZE, newTokens.length));
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(newTokens.length / BATCH_SIZE);

      statusLog.push(`📦 Batch ${batchNumber}/${totalBatches} (${batch.length} tokens)`);
      await updateDashboard(
        Math.min(i, newTokens.length),
        newTokens.length,
        `Processing batch ${batchNumber}/${totalBatches}...`
      );

      const batchPromises = batch.map(async (token) => {
        const tokenPreview = `...${token.slice(-6)}`;

        // Validate token format
        if (!TOKEN_REGEX.test(token)) {
          results.invalid.push(tokenPreview);
          results.badTokens.invalid.push(token);
          statusLog.push(`❌ Invalid: ${tokenPreview}`);
          processedCount++;
          return;
        }

        // Check if already exists
        if (existing.includes(token)) {
          results.skipped.push(tokenPreview);
          results.badTokens.duplicates.push(token);
          statusLog.push(`⚠️ Duplicate: ${tokenPreview}`);
          processedCount++;
          return;
        }

        // Attempt login with retry
        const result = await loginWithRetry(token, tokenPreview);

        if (result.success) {
          updatedTokens.push(token);
          results.success.push(`${result.userTag} (${tokenPreview})`);
          statusLog.push(`✅ Success: ${result.userTag}`);
          
          // Store working token with metadata
          results.workingTokens.push({
            token: token,
            userTag: result.userTag,
            userId: result.userId,
            addedAt: new Date().toISOString()
          });
        } else {
          results.failed.push(`${tokenPreview} - ${result.error}`);
          statusLog.push(`❌ Failed: ${tokenPreview} (${result.error})`);
          
          // Categorize bad tokens
          if (result.error === ERROR_TYPES.TOKEN_BANNED) {
            results.badTokens.banned.push(token);
          } else if (result.error === ERROR_TYPES.TOKEN_DISABLED) {
            results.badTokens.disabled.push(token);
          } else {
            results.badTokens.failed.push(token);
          }
        }

        processedCount++;
      });

      await Promise.allSettled(batchPromises);

      // Update dashboard after each batch
      await updateDashboard(
        Math.min(i + BATCH_SIZE, newTokens.length),
        newTokens.length,
        `Batch ${batchNumber}/${totalBatches} completed`
      );

      // Delay between batches to avoid rate limits
      if (i + BATCH_SIZE < newTokens.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Save updated tokens with rollback protection
    let fileSaveSuccess = false;
    try {
      fs.writeFileSync(tokensFile, updatedTokens.join("\n"), "utf-8");
      fileSaveSuccess = true;
      statusLog.push(`💾 Saved ${updatedTokens.length} tokens to file`);
    } catch (err) {
      statusLog.push(`❌ File save failed: ${err.message}`);

      // Attempt rollback from backup
      if (fs.existsSync(backupFile)) {
        try {
          fs.copyFileSync(backupFile, tokensFile);
          statusLog.push(`✅ Restored from backup`);
        } catch (rollbackErr) {
          statusLog.push(`❌ Rollback failed: ${rollbackErr.message}`);
        }
      }
    }

    // Final dashboard update
    await updateDashboard(
      newTokens.length,
      newTokens.length,
      "All tokens processed!",
      true
    );

    // Send working tokens to log channel with 2 files
    if (logChannel && results.workingTokens.length > 0) {
      try {
        const timestamp = Date.now();

        // FILE 1: Detailed token log with metadata
        let detailedLogContent = `# Working Tokens Backup Log\n`;
        detailedLogContent += `Added: ${new Date().toLocaleString()}\n`;
        detailedLogContent += `Total: ${results.workingTokens.length} tokens\n\n`;
        detailedLogContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        results.workingTokens.forEach((tokenData, index) => {
          detailedLogContent += `[${index + 1}] ${tokenData.userTag} (ID: ${tokenData.userId})\n`;
          detailedLogContent += `Token: ${tokenData.token}\n`;
          detailedLogContent += `Added At: ${tokenData.addedAt}\n`;
          detailedLogContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        });

        // FILE 2: Clean tokens only (one per line)
        const cleanTokensContent = results.workingTokens.map(t => t.token).join("\n");

        // Create buffers and attachments
        const detailedBuffer = Buffer.from(detailedLogContent, "utf-8");
        const cleanBuffer = Buffer.from(cleanTokensContent, "utf-8");

        const detailedAttachment = new AttachmentBuilder(detailedBuffer, { 
          name: `detailed-log-${timestamp}.txt` 
        });

        const cleanAttachment = new AttachmentBuilder(cleanBuffer, { 
          name: `tokens-only-${timestamp}.txt` 
        });

        // Create log embed
        const logEmbed = new EmbedBuilder()
          .setTitle("📝 Token Backup Log")
          .setColor(0x2ecc71)
          .setDescription(`Successfully added **${results.workingTokens.length}** new working tokens`)
          .addFields(
            { name: "📊 Summary", value: `${results.workingTokens.length} tokens logged`, inline: true },
            { name: "⏰ Timestamp", value: new Date().toLocaleString(), inline: true },
            { name: "👤 Added By", value: `<@${isSlash ? ctx.user.id : ctx.author.id}>`, inline: true }
          )
          .addFields({
            name: "✅ Accounts Added",
            value: results.workingTokens.slice(0, 10).map(t => `• ${t.userTag}`).join("\n") 
              + (results.workingTokens.length > 10 ? `\n*...and ${results.workingTokens.length - 10} more*` : ""),
            inline: false
          })
          .addFields({
            name: "📄 Files Attached",
            value: "**1.** `detailed-log-*.txt` - Full log with usernames & IDs\n**2.** `tokens-only-*.txt` - Clean tokens (one per line)",
            inline: false
          })
          .setFooter({ text: "Keep these files secure! Tokens can be used to access accounts." })
          .setTimestamp();

        await logChannel.send({ 
          embeds: [logEmbed], 
          files: [detailedAttachment, cleanAttachment] 
        });

        statusLog.push(`📝 Sent token logs to #${logChannel.name}`);
      } catch (err) {
        console.error("Failed to send tokens to log channel:", err);
        statusLog.push(`⚠️ Failed to log tokens: ${err.message}`);
      }
    }

    // Wait 2 seconds before showing detailed summary
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Calculate total bad tokens
    const totalBadTokens = 
      results.badTokens.invalid.length + 
      results.badTokens.duplicates.length + 
      results.badTokens.banned.length + 
      results.badTokens.disabled.length + 
      results.badTokens.failed.length;

    // Create detailed summary embed
    const summaryEmbed = new EmbedBuilder()
      .setTitle("📋 Detailed Token Addition Summary")
      .setColor(results.failed.length === 0 ? 0x2ecc71 : results.success.length > 0 ? 0xf39c12 : 0xe74c3c)
      .setDescription(
        fileSaveSuccess
          ? `✅ Successfully saved **${updatedTokens.length}** tokens to file.`
          : `⚠️ File save encountered issues. Check backup file.`
      )
      .addFields(
        {
          name: "✅ Successfully Added",
          value: results.success.length > 0
            ? results.success.slice(0, 10).join("\n") + (results.success.length > 10 ? `\n*...and ${results.success.length - 10} more*` : "")
            : "None",
          inline: false
        },
        {
          name: "❌ Failed to Add",
          value: results.failed.length > 0
            ? results.failed.slice(0, 10).join("\n") + (results.failed.length > 10 ? `\n*...and ${results.failed.length - 10} more*` : "")
            : "None",
          inline: false
        },
        {
          name: "⚠️ Skipped (Duplicates)",
          value: results.skipped.length > 0
            ? results.skipped.slice(0, 10).join(", ") + (results.skipped.length > 10 ? `\n*...and ${results.skipped.length - 10} more*` : "")
            : "None",
          inline: false
        },
        {
          name: "🚫 Invalid Format",
          value: results.invalid.length > 0
            ? results.invalid.slice(0, 10).join(", ") + (results.invalid.length > 10 ? `\n*...and ${results.invalid.length - 10} more*` : "")
            : "None",
          inline: false
        },
        {
          name: "🔄 Required Retries",
          value: results.retried.length > 0
            ? `${results.retried.length} tokens needed ${MAX_RETRIES > 1 ? "multiple attempts" : "retry"}`
            : "None",
          inline: false
        }
      )
      .addFields(
        { name: "📊 Total Processed", value: `${newTokens.length}`, inline: true },
        { name: "✅ Added", value: `${results.success.length}`, inline: true },
        { name: "❌ Failed", value: `${results.failed.length}`, inline: true },
        { name: "⏱️ Total Time", value: `${((Date.now() - startTime) / 1000).toFixed(1)}s`, inline: true },
        { name: "📈 Success Rate", value: `${((results.success.length / Math.max(toProcess, 1)) * 100).toFixed(1)}%`, inline: true },
        { name: "💾 Total Tokens", value: `${updatedTokens.length}`, inline: true }
      )
      .setFooter({
        text: `Completed at ${new Date().toLocaleTimeString()} | Backup: tokens.backup.txt`
      })
      .setTimestamp();

    // Add log channel info if used
    if (logChannel && results.workingTokens.length > 0) {
      summaryEmbed.addFields({
        name: "📝 Token Backup",
        value: `✅ Logged ${results.workingTokens.length} working tokens to <#${logChannel.id}> (2 files)`,
        inline: false
      });
    }

    // Create action buttons for bad token management
    const buttons = [];
    
    if (totalBadTokens > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId("export_bad_tokens")
          .setLabel(`📥 Export Bad Tokens (${totalBadTokens})`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📄")
      );

      buttons.push(
        new ButtonBuilder()
          .setCustomId("view_bad_tokens")
          .setLabel("👁️ View Bad Tokens")
          .setStyle(ButtonStyle.Secondary)
      );

      buttons.push(
        new ButtonBuilder()
          .setCustomId("remove_bad_tokens")
          .setLabel("🗑️ Remove from tokens.txt")
          .setStyle(ButtonStyle.Danger)
      );
    }

    const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];

    try {
      if (isSlash) {
        await ctx.editReply({ embeds: [summaryEmbed], components });
      } else {
        await dashboardMsg.edit({ embeds: [summaryEmbed], components });
      }
    } catch (err) {
      console.error("Failed to show summary:", err.message);
      try {
        if (isSlash) {
          await ctx.followUp({ embeds: [summaryEmbed], components, ephemeral: !isPublic });
        } else {
          await ctx.channel.send({ embeds: [summaryEmbed], components });
        }
      } catch (followErr) {
        console.error("Failed to send follow-up summary:", followErr.message);
      }
      return;
    }

    // Only set up collector if there are bad tokens
    if (totalBadTokens === 0) return;

    // Create button collector
    const collector = dashboardMsg.createMessageComponentCollector({ 
      time: 300000 // 5 minutes
    });

    collector.on("collect", async (interaction) => {
      // Check if the user is the command author
      if (interaction.user.id !== (isSlash ? ctx.user.id : ctx.author.id)) {
        return interaction.reply({ 
          content: "❌ This interaction is not for you!", 
          ephemeral: true 
        });
      }

      try {
        if (interaction.customId === "export_bad_tokens") {
          await interaction.deferReply({ ephemeral: true });

          // Create categorized bad tokens text
          let badTokensContent = "# Bad Tokens Export\n\n";
          
          if (results.badTokens.invalid.length > 0) {
            badTokensContent += `## Invalid Format (${results.badTokens.invalid.length})\n`;
            badTokensContent += results.badTokens.invalid.join("\n") + "\n\n";
          }
          
          if (results.badTokens.duplicates.length > 0) {
            badTokensContent += `## Duplicates (${results.badTokens.duplicates.length})\n`;
            badTokensContent += results.badTokens.duplicates.join("\n") + "\n\n";
          }
          
          if (results.badTokens.banned.length > 0) {
            badTokensContent += `## Banned/Locked (${results.badTokens.banned.length})\n`;
            badTokensContent += results.badTokens.banned.join("\n") + "\n\n";
          }
          
          if (results.badTokens.disabled.length > 0) {
            badTokensContent += `## Disabled (${results.badTokens.disabled.length})\n`;
            badTokensContent += results.badTokens.disabled.join("\n") + "\n\n";
          }
          
          if (results.badTokens.failed.length > 0) {
            badTokensContent += `## Failed (${results.badTokens.failed.length})\n`;
            badTokensContent += results.badTokens.failed.join("\n") + "\n\n";
          }

          // Create a buffer and send as file
          const buffer = Buffer.from(badTokensContent, "utf-8");
          const attachment = new AttachmentBuilder(buffer, { 
            name: `bad-tokens-${Date.now()}.txt` 
          });
          
          await interaction.editReply({
            content: `✅ Exported **${totalBadTokens}** bad tokens to file!`,
            files: [attachment]
          });

        } else if (interaction.customId === "view_bad_tokens") {
          await interaction.deferReply({ ephemeral: true });

          const viewEmbed = new EmbedBuilder()
            .setTitle("👁️ Bad Tokens Breakdown")
            .setColor(0xe74c3c)
            .setDescription(`Total: **${totalBadTokens}** bad tokens`)
            .setTimestamp();

          if (results.badTokens.invalid.length > 0) {
            const preview = results.badTokens.invalid.slice(0, 5).map(t => `\`...${t.slice(-6)}\``).join(", ");
            viewEmbed.addFields({
              name: `🚫 Invalid Format (${results.badTokens.invalid.length})`,
              value: preview + (results.badTokens.invalid.length > 5 ? ` +${results.badTokens.invalid.length - 5} more` : ""),
              inline: false
            });
          }

          if (results.badTokens.duplicates.length > 0) {
            const preview = results.badTokens.duplicates.slice(0, 5).map(t => `\`...${t.slice(-6)}\``).join(", ");
            viewEmbed.addFields({
              name: `⚠️ Duplicates (${results.badTokens.duplicates.length})`,
              value: preview + (results.badTokens.duplicates.length > 5 ? ` +${results.badTokens.duplicates.length - 5} more` : ""),
              inline: false
            });
          }

          if (results.badTokens.banned.length > 0) {
            const preview = results.badTokens.banned.slice(0, 5).map(t => `\`...${t.slice(-6)}\``).join(", ");
            viewEmbed.addFields({
              name: `🔒 Banned/Locked (${results.badTokens.banned.length})`,
              value: preview + (results.badTokens.banned.length > 5 ? ` +${results.badTokens.banned.length - 5} more` : ""),
              inline: false
            });
          }

          if (results.badTokens.disabled.length > 0) {
            const preview = results.badTokens.disabled.slice(0, 5).map(t => `\`...${t.slice(-6)}\``).join(", ");
            viewEmbed.addFields({
              name: `❌ Disabled (${results.badTokens.disabled.length})`,
              value: preview + (results.badTokens.disabled.length > 5 ? ` +${results.badTokens.disabled.length - 5} more` : ""),
              inline: false
            });
          }

          if (results.badTokens.failed.length > 0) {
            const preview = results.badTokens.failed.slice(0, 5).map(t => `\`...${t.slice(-6)}\``).join(", ");
            viewEmbed.addFields({
              name: `⚠️ Other Failed (${results.badTokens.failed.length})`,
              value: preview + (results.badTokens.failed.length > 5 ? ` +${results.badTokens.failed.length - 5} more` : ""),
              inline: false
            });
          }

          viewEmbed.addFields({
            name: "💡 Tip",
            value: "Use **📥 Export Bad Tokens** to get the full list, or **🗑️ Remove from tokens.txt** to clean them up.",
            inline: false
          });

          await interaction.editReply({ embeds: [viewEmbed] });

        } else if (interaction.customId === "remove_bad_tokens") {
          await interaction.deferReply({ ephemeral: true });

          // Collect all bad tokens
          const allBadTokens = [
            ...results.badTokens.duplicates,
            ...results.badTokens.banned,
            ...results.badTokens.disabled
          ];

          if (allBadTokens.length === 0) {
            return interaction.editReply({
              content: "✅ No tokens to remove from tokens.txt (invalid/duplicates don't need removal)."
            });
          }

          try {
            // Read current tokens.txt
            let currentTokens = [];
            if (fs.existsSync(tokensFile)) {
              currentTokens = fs
                .readFileSync(tokensFile, "utf-8")
                .split(/[\r\n]+/)
                .map((t) => t.trim())
                .filter(Boolean);
            }

            // Filter out bad tokens
            const cleanedTokens = currentTokens.filter(t => !allBadTokens.includes(t));
            const removedCount = currentTokens.length - cleanedTokens.length;

            // Create another backup before removing
            if (fs.existsSync(tokensFile)) {
              fs.copyFileSync(tokensFile, path.join(__dirname, "../tokens.pre-cleanup.backup.txt"));
            }

            // Save cleaned tokens
            fs.writeFileSync(tokensFile, cleanedTokens.join("\n"), "utf-8");

            const removeEmbed = new EmbedBuilder()
              .setTitle("🗑️ Bad Tokens Removed")
              .setColor(0x2ecc71)
              .setDescription(`Successfully removed **${removedCount}** bad tokens from tokens.txt`)
              .addFields(
                { name: "📊 Before", value: `${currentTokens.length} tokens`, inline: true },
                { name: "📊 After", value: `${cleanedTokens.length} tokens`, inline: true },
                { name: "🗑️ Removed", value: `${removedCount} tokens`, inline: true }
              )
              .addFields({
                name: "💾 Backup Created",
                value: "`tokens.pre-cleanup.backup.txt`",
                inline: false
              })
              .setFooter({ text: "You can restore from backup if needed" })
              .setTimestamp();

            await interaction.editReply({ embeds: [removeEmbed] });

            // Disable all buttons after removal
            const disabledButtons = buttons.map(btn => 
              ButtonBuilder.from(btn).setDisabled(true)
            );
            const disabledRow = new ActionRowBuilder().addComponents(disabledButtons);

            await dashboardMsg.edit({ components: [disabledRow] });
            collector.stop();

          } catch (err) {
            await interaction.editReply({
              content: `❌ Failed to remove tokens: ${err.message}\nCheck backup files for recovery.`
            });
          }
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
      // Disable buttons after timeout
      const disabledButtons = buttons.map(btn => 
        ButtonBuilder.from(btn).setDisabled(true)
      );
      const disabledRow = new ActionRowBuilder().addComponents(disabledButtons);
      
      dashboardMsg.edit({ components: [disabledRow] }).catch(console.error);
    });
  }
};
