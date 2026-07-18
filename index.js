require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const TOKEN = process.env.DISCORD_TOKEN;
const FREE_WEBHOOK = process.env.FREE_WEBHOOK;
const FREE_ROLE_ID = "1509514820913729557";
const NOTIFIED_FILE = path.join(__dirname, "notified.json");

let notifiedItems = new Set();
let initialized = false;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running");
}).listen(process.env.PORT || 10000);

function loadNotified() {
  try {
    if (fs.existsSync(NOTIFIED_FILE)) {
      const data = JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf8"));
      notifiedItems = new Set(data);
    }
  } catch (e) {}
}

function saveNotified() {
  try {
    fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...notifiedItems]));
  } catch (e) {}
}

async function checkFreeUGC() {
  try {
    const res = await axios.get("https://www.rolimons.com/api/free-limiteds", { timeout: 10000 }).catch(() => null);
    if (!res?.data) return;

    const items = res.data.freeLimiteds || [];

    let addedAny = false;

    for (const item of items) {
      const id = item.assetId.toString();
      if (notifiedItems.has(id)) continue;

      notifiedItems.add(id);
      addedAny = true;

      if (!initialized) continue;

      const img = `https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png`;

      await axios.post(FREE_WEBHOOK, {
        content: `<@&${FREE_ROLE_ID}> **NEW FREE LIMITED UGC DETECTED!**`,
        embeds: [{
          title: item.name,
          url: `https://www.roblox.com/catalog/${id}`,
          color: 0x00ff00,
          fields: [
            { name: "Stock", value: item.remainingStock || "Limited", inline: true },
            { name: "From", value: "Rolimons", inline: true }
          ],
          image: { url: img },
          footer: { text: `ID: ${id}` },
          timestamp: new Date().toISOString()
        }]
      }).catch(() => {});

      await new Promise(r => setTimeout(r, 1500));
    }

    if (addedAny) saveNotified();
    initialized = true;
  } catch (e) {}
}

cron.schedule("* * * * *", checkFreeUGC);

client.once(Events.ClientReady, async () => {
  loadNotified();
  await checkFreeUGC();
});

client.login(TOKEN);
