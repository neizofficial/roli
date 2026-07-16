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
const PAID_WEBHOOK = process.env.PAID_WEBHOOK
const WEB_WEBHOOK = process.env.WEB_WEBHOOK

let notifiedItems = new Set()

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" })
  res.end("OK")
}).listen(process.env.PORT || 10000)

async function sendWebhookTo(url, embed) {
  if (!url) return
  try {
    await axios.post(url, { embeds: [embed] })
  } catch (e) {
    console.error(`Webhook failed (${url.slice(0, 50)}...):`, e.message)
  }
}

async function getItemImage(itemId) {
  try {
    const res = await axios.get(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${itemId}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`,
      { headers: { Accept: "application/json" } }
    )
    return res.data?.data?.[0]?.imageUrl ?? null
  } catch {
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

    let newCount = 0

    for (const item of unique) {
      const itemId = item.id?.toString()
      const isFree = item.price === 0 || item.price === null
      const isUGC = item.creatorType === "User" || item.creatorType === "Group"
      if (!itemId || !isUGC || notifiedItems.has(itemId)) continue

      notifiedItems.add(itemId)
      newCount++

      const imageUrl = await getItemImage(itemId)

      const robloxUrl = `https://www.roblox.com/catalog/${itemId}`
      const rolimonsUrl = `https://www.rolimons.com/item/${itemId}`
      const tryOnGameUrl = "https://www.roblox.com/games/5233461676/Try-on-Catalog-Items"

      const freeEmbed = {
        title: `FREE UGC: ${item.name}`,
        url: robloxUrl,
        fields: [
          { name: "💰 Price", value: "FREE", inline: true },
          { name: "📦 Stock", value: `${item.unitsAvailableForConsumption ?? "?"}`, inline: true },
          { name: "👤 Creator", value: item.creatorName ?? "Unknown", inline: true },
          { name: "🔗 Links", value: `[Roblox Catalog](${robloxUrl}) • [Rolimons](${rolimonsUrl})` }
        ],
        color: 3447003,
        footer: { text: "Free UGC Alert" },
        timestamp: new Date().toISOString()
      }

      const paidEmbed = {
        title: `PAID UGC (seen with free search): ${item.name}`,
        url: robloxUrl,
        fields: [
          { name: "💰 Price", value: item.price ? item.price.toString() : "Unknown", inline: true },
          { name: "📦 Stock", value: `${item.unitsAvailableForConsumption ?? "?"}`, inline: true },
          { name: "👤 Creator", value: item.creatorName ?? "Unknown", inline: true },
          { name: "🔗 Links", value: `[Roblox Catalog](${robloxUrl}) • [Rolimons](${rolimonsUrl})` }
        ],
        color: 15548997,
        footer: { text: "Paid UGC Seen" },
        timestamp: new Date().toISOString()
      }

      const webEmbed = {
        title: `UGC Info: ${item.name}`,
        url: robloxUrl,
        fields: [
          { name: "💰 Price", value: isFree ? "FREE" : (item.price ? item.price.toString() : "Unknown"), inline: true },
          { name: "📦 Stock", value: `${item.unitsAvailableForConsumption ?? "?"}`, inline: true },
          { name: "👤 Creator", value: item.creatorName ?? "Unknown", inline: true },
          { name: "🔗 Links", value: `[Roblox Catalog](${robloxUrl}) • [Rolimons](${rolimonsUrl}) • [Try-On Game](${tryOnGameUrl})` }
        ],
        color: 5763719,
        footer: { text: "UGC Web Feed" },
        timestamp: new Date().toISOString()
      }

      if (imageUrl) {
        freeEmbed.thumbnail = { url: imageUrl }
        paidEmbed.thumbnail = { url: imageUrl }
        webEmbed.thumbnail = { url: imageUrl }
      }

      if (isFree) {
        await sendWebhookTo(FREE_WEBHOOK, freeEmbed)
      } else {
        await sendWebhookTo(PAID_WEBHOOK, paidEmbed)
      }

      await sendWebhookTo(WEB_WEBHOOK, webEmbed)

      console.log(`Notified FREE/PAID/WEB: ${item.name} (${itemId})`)
    }

    console.log(`Check complete: scanned ${unique.length} items, ${newCount} new, ${notifiedItems.size} total tracked.`)
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
        { name: "!testugc", value: "Test the UGC notification" },
        { name: "!help", value: "Show this menu" }
      )
      .setColor(0x2ecc71)

    msg.reply({ embeds: [embed] })
  }

  if (msg.content === "!testugc") {
    const robloxUrl = "https://www.roblox.com/catalog/0"
    const rolimonsUrl = "https://www.rolimons.com/item/0"
    const tryOnGameUrl = "https://www.roblox.com/games/5233461676/Try-on-Catalog-Items"

    const freeEmbed = {
      title: "🧪 Test FREE UGC Alert",
      description: "Test embed for FREE channel.",
      color: 3447003,
      footer: { text: "Free UGC Alert" },
      timestamp: new Date().toISOString(),
      fields: [
        { name: "🔗 Links", value: `[Roblox Catalog](${robloxUrl}) • [Rolimons](${rolimonsUrl})` }
      ]
    }

    const paidEmbed = {
      title: "🧪 Test PAID UGC Alert",
      description: "Test embed for PAID channel.",
      color: 15548997,
      footer: { text: "Paid UGC Alert" },
      timestamp: new Date().toISOString(),
      fields: [
        { name: "🔗 Links", value: `[Roblox Catalog](${robloxUrl}) • [Rolimons](${rolimonsUrl})` }
      ]
    }

    const webEmbed = {
      title: "🧪 Test WEB UGC Alert",
      description: "Test embed for WEB channel.",
      color: 5763719,
      footer: { text: "Web UGC Alert" },
      timestamp: new Date().toISOString(),
      fields: [
        { name: "🔗 Links", value: `[Roblox Catalog](${robloxUrl}) • [Rolimons](${rolimonsUrl}) • [Try-On Game](${tryOnGameUrl})` }
      ]
    }

    await sendWebhookTo(FREE_WEBHOOK, freeEmbed)
    await sendWebhookTo(PAID_WEBHOOK, paidEmbed)
    await sendWebhookTo(WEB_WEBHOOK, webEmbed)

    msg.reply("✅ Test sent to FREE, PAID, and WEB!")
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
          { name: "💰 Value", value: data[3] && data[3] !== -1 ? `${data[3].toLocaleString()} Value` : "No value", inline: true },
          { name: "📈 Demand", value: ["Unassigned", "Terrible", "Low", "Normal", "High", "Amazing"][data[5]] ?? "Unknown", inline: true },
          { name: "📊 Trend", value: ["Unassigned", "Lowering", "Unstable", "Stable", "Rising", "Projected"][data[6]] ?? "Unknown", inline: true }
        )
        .setColor(0x00b4d8)
        .setFooter({ text: "Powered by Rolimons" })

      if (imageUrl) embed.setThumbnail(imageUrl)
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
        .setColor(0x9b59b6)
        .setURL(`https://www.rolimons.com/player/${userId}`)

      msg.reply({ embeds: [embed] })
    } catch {
      msg.reply("⚠️ Player not found.")
    }
  }
})

client.once("ready", () => {
  console.log(`✅ Bot online as ${client.user.tag}`)
  console.log(`🚀 Deployed at: ${new Date().toISOString()}`)
  checkFreeUGC()
})

client.login(TOKEN)
