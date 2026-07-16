require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
let notifiedItems = new Set();

async function sendWebhook(embed) {
  await axios.post(WEBHOOK_URL, { embeds: [embed] });
}

async function getItemImage(itemId) {
  try {
    const res = await axios.get(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${itemId}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`,
      { headers: { "Accept": "application/json" } }
    );
    return res.data?.data?.[0]?.imageUrl ?? null;
  } catch {
    return null;
  }
}

async function checkFreeUGC() {
  try {
    const urls = [
      "https://catalog.roblox.com/v1/search/items/details?Category=11&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
      "https://catalog.roblox.com/v1/search/items/details?Category=3&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
      "https://catalog.roblox.com/v1/search/items/details?Category=4&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
      "https://catalog.roblox.com/v1/search/items/details?Category=8&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
      "https://catalog.roblox.com/v1/search/items/details?Category=12&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
    ];

    const results = await Promise.all(
      urls.map(u => axios.get(u, { headers: { "Accept": "application/json" } }).catch(() => null))
    );

    const allItems = results.flatMap(r => r?.data?.data ?? []);
    const seen = new Set();
    const unique = allItems.filter(i => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });

    for (const item of unique) {
      const itemId = item.id?.toString();
      const isFree = item.price === 0 || item.price === null;
      const isUGC = item.creatorType === "User" || item.creatorType === "Group";
      if (!itemId || !isFree || !isUGC || notifiedItems.has(itemId)) continue;

      notifiedItems.add(itemId);

      const imageUrl = await getItemImage(itemId);

      const embed = {
        title: `>: ${item.name}`,
        url: `https://www.roblox.com/catalog/${itemId}`,
        fields: [
          { name: "💰 Price", value: "FREE", inline: true },
          { name: "📦 Stock", value: `${item.unitsAvailableForConsumption ?? "?"}`, inline: true },
          { name: "👤 Creator", value: item.creatorName ?? "Unknown", inline: true },
          { name: "🔗 Links", value: `[Roblox Page](https://www.roblox.com/catalog/${itemId}) • [Rolimons](https://www.rolimons.com/item/${itemId})` }
        ],
        color: 0x00ff88,
        footer: { text: "Free UGC Alert" },
        timestamp: new Date().toISOString()
      };

      if (imageUrl) embed.thumbnail = { url: imageUrl };

      await sendWebhook(embed);
      console.log(`Notified: ${item.name} (${itemId})`);
    }
  } catch (e) {
    console.error("Check error:", e.message);
  }
}

cron.schedule("* * * * *", checkFreeUGC);

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === "!help") {
    const embed = new EmbedBuilder()
      .setTitle("🤖 RoliBot Commands")
      .addFields(
        { name: "!value <item>", value: "Look up item value, demand & trend" },
        { name: "!player <userId>", value: "Check player inventory value" },
        { name: "!testugc", value: "Test the UGC notification" },
        { name: "!help", value: "Show this menu" }
      )
      .setColor(0x2ecc71);
    msg.reply({ embeds: [embed] });
  }

  if (msg.content === "!testugc") {
    await sendWebhook({
      title: "🧪 Test UGC Alert",
      description: "This is a test of the free UGC notification system.",
      color: 0x00ff88,
      footer: { text: "Free UGC Alert" },
      timestamp: new Date().toISOString()
    });
    msg.reply("✅ Test sent!");
  }

  if (msg.content.startsWith("!value ")) {
    const query = msg.content.slice(7).toLowerCase();
    try {
      const res = await axios.get("https://www.rolimons.com/itemapi/itemdetails");
      const items = res.data.items;
      const match = Object.entries(items).find(([id, data]) => data[0].toLowerCase().includes(query));
      if (!match) return msg.reply("❌ Item not found!");
      const [id, data] = match;
      const imageUrl = await getItemImage(id);
      const embed = new EmbedBuilder()
        .setTitle(`📦 ${data[0]}`)
        .setURL(`https://www.rolimons.com/item/${id}`)
        .addFields(
          { name: "💰 Value", value: data[2] ? `${data[2].toLocaleString()} RAP` : "No value", inline: true },
          { name: "📈 Demand", value: ["Unassigned","Terrible","Low","Normal","High","Amazing"][data[5]] ?? "Unknown", inline: true },
          { name: "📊 Trend", value: ["Unassigned","Lowering","Unstable","Stable","Rising","Projected"][data[6]] ?? "Unknown", inline: true }
        )
        .setColor(0x00b4d8)
        .setFooter({ text: "Powered by Rolimons" });
      if (imageUrl) embed.setThumbnail(imageUrl);
      msg.reply({ embeds: [embed] });
    } catch (e) { msg.reply("⚠️ Failed to fetch data."); }
  }

  if (msg.content.startsWith("!player ")) {
    const userId = msg.content.slice(8).trim();
    try {
      const res = await axios.get(`https://www.rolimons.com/playerapi/player/${userId}`);
      const data = res.data;
      const embed = new EmbedBuilder()
        .setTitle(`👤 Player: ${data.player_name}`)
        .addFields(
          { name: "💎 Value", value: `${data.player_value?.toLocaleString() ?? "N/A"} RAP`, inline: true },
          { name: "🎒 Items", value: `${data.inventory_count ?? "N/A"}`, inline: true }
        )
        .setColor(0x9b59b6)
        .setURL(`https://www.rolimons.com/player/${userId}`);
      msg.reply({ embeds: [embed] });
    } catch (e) { msg.reply("⚠️ Player not found."); }
  }
});

client.once("ready", () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  checkFreeUGC();
});

client.login(TOKEN);
