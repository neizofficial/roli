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
  } catch (e) { console.error("Error loading JSON:", e); }
}

function saveNotified() {
  try {
    fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...notifiedItems]));
  } catch (e) { console.error("Error saving JSON:", e); }
}

async function checkFreeUGC() {
  try {
    console.log(`[${new Date().toLocaleTimeString()}] Checking catalog...`);

    const urls = [
      "https://catalog.roblox.com/v1/search/items/details?Category=11&Limit=30&MinPrice=0&MaxPrice=0&SortType=2",
      "https://catalog.roblox.com/v1/search/items/details?Category=3&Limit=30&MinPrice=0&MaxPrice=0&SortType=2"
    ];

    const results = await Promise.all(urls.map(u => axios.get(u, { timeout: 5000 }).catch(() => null)));
    const items = results.flatMap(r => r?.data?.data ?? []);
    const unique = Array.from(new Map(items.map(i => [i.id, i])).values());

    let addedAny = false;

    for (const item of unique) {
      const id = item.id.toString();
      if (notifiedItems.has(id)) continue;

      const isFree = item.price === 0 || item.price === null;
      const isLimited = item.itemType === "Asset" && (item.collectibleItemId || (item.unitsAvailableForConsumption && item.unitsAvailableForConsumption > 0));

      if (isFree && isLimited) {
        notifiedItems.add(id);
        addedAny = true;

        if (!initialized) {
          console.log(`Found existing item on startup: ${item.name}`);
          continue;
        }

        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png`).catch(() => null);
        const img = thumbRes?.data?.data?.[0]?.imageUrl || "";

        await axios.post(FREE_WEBHOOK, {
          content: `<@&${FREE_ROLE_ID}> **NEW FREE LIMITED DETECTED!**`,
          embeds: [{
            title: item.name,
            url: `https://www.roblox.com/catalog/${id}`,
            color: 0x00ff00,
            fields: [
              { name: "📦 Stock Remaining", value: `${item.unitsAvailableForConsumption || "Unknown"}`, inline: true },
              { name: "👤 Creator", value: `[${item.creatorName}](https://www.roblox.com/users/${item.creatorTargetId}/profile)`, inline: true }
            ],
            image: { url: img },
            footer: { text: `Item ID: ${id}` },
            timestamp: new Date().toISOString()
          }]
        }).catch(err => console.error("Webhook Error:", err.message));

        console.log(`🔔 Alert sent for: ${item.name}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (addedAny) saveNotified();
    initialized = true;
  } catch (e) {
    console.error("Error in checkFreeUGC:", e.message);
  }
}

cron.schedule("* * * * *", checkFreeUGC);

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  loadNotified();
  await checkFreeUGC();
});

client.login(TOKEN);
