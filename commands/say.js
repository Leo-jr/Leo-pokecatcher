// commands/say.js
module.exports = {
  name: "say",
  description: "Make the bot say something.",
  ownerOnly: true, // Only owners can run this command

  execute(message, args) {
    const text = args.join(" ");
    if (!text) {
      return message.reply("⚠️ Please provide text to say.");
    }

    message.channel.send(text);
  },
};
