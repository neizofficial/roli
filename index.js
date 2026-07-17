require("dotenv").config()
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js")
const axios = require("axios")
const cron = require("node-cron")
const http = require("http")
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})
const TOKEN = process.env.DISCORD_TOKEN
const FREE_WEBHOOK = process.env.FREE_WEBHOOK
const FREE_ROLE_ID = "1509514820913729557"
const ROSE_ICON_URL = "https://i.imgur.com/your-uploaded-icon.png"
let notifiedItems = new Set()
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" })
  res.end("OK")
}).listen(process.env.PORT || 10000)
async function sendWebhookTo(url, payload) {
  if (!url) return
  try {
    await axios.post(url, payload)
  } catch (e) {
    console.error(`Webhook failed:`, e.message)
  }
}
async function getItemImage(itemId, itemType) {
  try {
    const isBundle = itemType === "Bundle"
    const url = isBundle
      ? `https://thumbnails.roblox.com/v1/bundles/icons?bundleIds=${itemId}&size=420x420&format=Png`
      : `https://thumbnails.roblox.com/v1/assets?assetIds=${itemId}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`
    const res = await axios.get(url, { headers: { Accept: "application/json" } })
    const imageUrl = res.data?.data?.[0]?.imageUrl
    if (!imageUrl) return null
    return imageUrl
  } catch (e) {
    console.error(`getItemImage failed for ${itemId}:`, e.message)
    return null
  }
}
async function checkFreeUGC() {
  try {
    const urls = [
      "https://catalog.roblox.com/v1/search/items/details?Category=11&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
      "https://catalog.roblox.com/v1/search/items/details?Category=3&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
      "https://catalog.roblox.com/v1/search/items/details?Category=4&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
      "https://catalog.roblox.com/v1/search/items/details?Category=8&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3",
      "https://catalog.roblox.com/v1/search/items/details?Category=12&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=3"
    ]
    const results = await Promise.all(
      urls.map(u => axios.get(u, { headers: { Accept: "application/json" } }).catch(() => null))
    )
    const allItems = results.flatMap(r => r?.data?.data ?? [])
    const seen = new Set()
    const unique = allItems.filter(i => {
      if (seen.has(i.id)) return false
      seen.add(i.id)
      return true
    })
    for (const item of unique) {
      const itemId = item.id?.toString()
      const isFree = item.price === 0 || item.price === null
      const isUGC = item.creatorType === "User" || item.creatorType === "Group"
      if (!itemId || !isUGC || notifiedItems.has(itemId)) continue
      notifiedItems.add(itemId)
      const imageUrl = await getItemImage(itemId, item.itemType)
      const itemUrl = `https://www.roblox.com/catalog/${itemId}`
      const rolimonsUrl = `https://www.rolimons.com/item/${itemId}`
      const creatorUrl = item.creatorTargetId
        ? (item.creatorType === "Group"
            ? `https://www.roblox.com/groups/${item.creatorTargetId}`
            : `https://www.roblox.com/users/${item.creatorTargetId}/profile`)
        : null
      const creatorValue = creatorUrl ? `[${item.creatorName ?? "Unknown"}](${creatorUrl})` : (item.creatorName ?? "Unknown")
      const freeEmbed = {
        title: item.name,
        color: 0xED4245,
        fields: [
          { name: "💰 Price", value: "FREE", inline: true },
          { name: "📦 Stock", value: `${item.unitsAvailableForConsumption ?? "1"}`, inline: true },
          { name: "👤 Creator", value: creatorValue, inline: true },
          { name: "Game", value: `[${item.name}](${itemUrl})` },
          { name: "Item", value: `<${rolimonsUrl}>` }
        ],
        thumbnail: { url: imageUrl || ROSE_ICON_URL },
        timestamp: new Date().toISOString()
      }
      await sendWebhookTo(FREE_WEBHOOK, {
        content: `<@&${FREE_ROLE_ID}>`,
        embeds: [freeEmbed]
      })
      console.log(`Notified: ${item.name} (${itemId})`)
    }
  } catch (e) {
    console.error("Check error:", e.message)
  }
}
cron.schedule("* * * * *", checkFreeUGC)
client.on("messageCreate", async msg => {
  if (msg.author.bot) return
  if (msg.content === "!help") {
    const embed = new EmbedBuilder()
      .setTitle("🤖 RoliBot Commands")
      .addFields(
        { name: "!value <item>", value: "Look up item value, demand & trend" },
        { name: "!player <userId>", value: "Check player inventory value" },
        { name: "!help", value: "Show this menu" }
      )
      .setColor(0xED4245)
    msg.reply({ embeds: [embed] })
  }
  if (msg.content.startsWith("!value ")) {
    const query = msg.content.slice(7).toLowerCase()
    try {
      const res = await axios.get("https://www.rolimons.com/itemapi/itemdetails")
      const items = res.data.items
      const match = Object.entries(items).find(([id, data]) => data[0].toLowerCase().includes(query))
      if (!match) return msg.reply("❌ Item not found!")
      const [id, data] = match
      const imageUrl = await getItemImage(id)
      const embed = new EmbedBuilder()
        .setTitle(`📦 ${data[0]}`)
        .setURL(`https://www.rolimons.com/item/${id}`)
        .addFields(
          { name: "💰 RAP", value: data[2] ? `${data[2].toLocaleString()} RAP` : "No RAP", inline: true },
          { name: "💰 Value", value: data[3] && data[3] !== -1 ? `${data[3].toLocaleString()} Value` : "No value", inline: true },
          { name: "📈 Demand", value: ["None", "Terrible", "Low", "Normal", "High", "Amazing"][data[5] + 1] ?? "Unknown", inline: true },
          { name: "📊 Trend", value: ["None", "Lowering", "Unstable", "Stable", "Raising", "Fluctuating"][data[6] + 1] ?? "Unknown", inline: true }
        )
        .setColor(0xED4245)
      if (imageUrl) embed.setThumbnail(imageUrl)
      else embed.setThumbnail(ROSE_ICON_URL)
      msg.reply({ embeds: [embed] })
    } catch {
      msg.reply("⚠️ Failed to fetch data.")
    }
  }
  if (msg.content.startsWith("!player ")) {
    const userId = msg.content.slice(8).trim()
    try {
      const res = await axios.get(`https://www.rolimons.com/playerapi/player/${userId}`)
      const data = res.data
      const embed = new EmbedBuilder()
        .setTitle(`👤 Player: ${data.player_name}`)
        .addFields(
          { name: "💎 Value", value: `${data.player_value?.toLocaleString() ?? "N/A"} RAP`, inline: true },
          { name: "🎒 Items", value: `${data.inventory_count ?? "N/A"}`, inline: true }
        )
        .setColor(0xED4245)
        .setURL(`https://www.rolimons.com/player/${userId}`)
        .setThumbnail(ROSE_ICON_URL)
      msg.reply({ embeds: [embed] })
    } catch {
      msg.reply("⚠️ Player not found.")
    }
  }
})
client.once("ready", () => {
  console.log(`✅ Bot online as ${client.user.tag}`)
  checkFreeUGC()
})
client.login(TOKEN)
