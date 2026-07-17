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

// Configuration
const TOKEN = process.env.DISCORD_TOKEN;
const FREE_WEBHOOK = process.env.FREE_WEBHOOK;
const FREE_ROLE_ID = "1509514820913729557"; // Ensure this ID is correct for your server
const NOTIFIED_FILE = path.join(__dirname, "notified.json");

let notifiedItems = new Set();
let initialized = false;

// HTTP Server for uptime monitoring (Render/Replit)
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running");
}).listen(process.env.PORT || 10000);

// Helper to load/save notified items
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

// Function to check Roblox Catalog
async function checkFreeUGC() {
  try {
    console.log(`[${new Date().toLocaleTimeString()}] Checking catalog...`);
    
    // API 1: Accessories, API 2: Clothing/Bundles
    // Added 'salesTypeFilter=2' which often catches Limiteds more accurately
    const urls = [
      "https://catalog.roblox.com/v1/search/items/details?Category=11&Limit=30&MinPrice=0&MaxPrice=0&SortType=2",
      "https://catalog.roblox.com/v1/search/items/details?Category=3&Limit=30&MinPrice=0&MaxPrice=0&SortType=2"
    ];

    const results = await Promise.all(urls.map(u => 
        axios.get(u, { timeout: 5000 }).catch(() => null)
    ));

    const items = results.flatMap(r => r?.data?.data ?? []);
    
    // Filter out duplicates from API results
    const unique = Array.from(new Map(items.map(i => [i.id, i])).values());
    
    let addedAny = false;

    for (const item of unique) {
      const id = item.id.toString();

      if (notifiedItems.has(id)) continue;

      // Logic: Item must be price 0 AND have a collectibleItemId (meaning it's a Limited)
      // Or check if unitsAvailableForConsumption > 0
      const isFree = item.price === 0 || item.price === null;
      const isLimited = item.itemType === "Asset" && (item.collectibleItemId || item.unitsAvailableForConsumption > 0);

      if (isFree && isLimited) {
        notifiedItems.add(id);
        addedAny = true;

        // If this is the first run since start, don't ping (prevents spamming old items)
        if (!initialized) {
          console.log(`Found existing item on startup: ${item.name}`);
          continue;
        }

        // Fetch Thumbnail
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png`).catch(() => null);
        const img = thumbRes?.data?.data?.[0]?.imageUrl || "";

        // Send to Discord Webhook
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
        }).catch(err => console.error("Webhook Error:", err.response?.data || err.message));

        console.log(`🔔 Alert sent for: ${item.name}`);
        // Small delay to prevent webhook rate limits
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (addedAny) saveNotified();
    initialized = true;

  } catch (e) {
    console.error("Error in checkFreeUGC loop:", e.message);
  }
}

// Cron: Every 1 minute
cron.schedule("* * * * *", checkFreeUGC);

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  loadNotified();
  // Initial check
  await checkFreeUGC();
});

client.login(TOKEN);
