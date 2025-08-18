// Spam event is intentionally disabled.
// Keeping this file so the event system stays consistent.

module.exports = (client) => {
  client.on("ready", () => {
    console.log(`(Spam disabled) ${client.user.username} will not spam.`);
  });
};
