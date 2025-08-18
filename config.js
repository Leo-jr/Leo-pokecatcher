module.exports = {
  owners: ["1390612289991872572", "987654321098765432"], // your owner IDs here
  prefix: "!", // global command prefix

  // Helper to check if user is owner
  isOwner(id) {
    return this.owners.includes(id);
  },

  captcha: {
    mode: "leo", // use main API
    // mode: "shu", // use Shu API
    licenseKey: "LEO-CAPTCHA-KEY", //buy your key from @ryomen.leo
    API_URL: "http://api.leoispro.shop/solve",
    shuApiKey: "SHU-API-KEY",
    shuHostname: "chutiya.shuupiro.online:3000",
  },
  // Common settings
  solveTimeout: 60 * 1000, // 60 seconds timeout for solving captcha
  retryDelay: 5000, // 5 seconds retry delay
  skipDuplicateWindow: 5 * 60 * 1000, // 5 minutes skip duplicate captcha

  catchMode: "hint", // or "hint" / "lenda"
  genderEmojis: {
    male: "♂️",
    female: "♀️",
    unknown: "❓",
  },

  webhookUrls: {
    captcha:
      "captcha-webhook-link",
    regular:
      "regular-webhook-link",
    rare: "rare-webhook-link",
    shiny: "shiny-webhook-link",
    gigantamax:
      "gigantamax-webhook-link",
    quest:
      "quest-webhook-link",
  },

  rarityColors: {
    regular: [0x00ffff, 0x40e0d0, 0x7fffd4], // Light cyan / teal
    rare: [0xba55d3, 0xda70d6, 0xffd700], // Orchid / gold
    shiny: [0xff69b4, 0xffb6c1, 0xff7f50], // Pinks / coral
    gigantamax: [0xffa07a, 0xff8c00, 0xe6e6fa], // Salmon / orange / lavender
  },
};
