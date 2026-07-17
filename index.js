require("dotenv").config()
const { Client, GatewayIntentBits } = require("discord.js")
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

async function getItemImage(itemId) {
  try {
    const res = await axios.get(`https://thumbnails.roblox.com/v1/assets?assetIds=${itemId}&size=420x420&format=Png`)
    return res.data?.data?.[0]?.imageUrl || null
  } catch {
    return null
  }
}

async function getGameInfo(itemId) {
  try {
    const detailsRes = await axios.get(`https://economy.roblox.com/v2/assets/${itemId}/details`)
    const saleLocation = detailsRes.data?.SaleLocation
    const universeId = saleLocation?.UniverseIds?.[0] ?? saleLocation?.universeIds?.[0]
    if (!universeId) return null

    const gameRes = await axios.get(`https://games.roblox.com/v1/games?universeIds=${universeId}`)
    const gameData = gameRes.data?.data?.[0]
    if (!gameData?.rootPlaceId) return null

    return {
      name: gameData.name || "Game",
      url: `https://www.roblox.com/games/${gameData.rootPlaceId}`
    }
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
    const unique = allItems.filter(i => !seen.has(i.id) && seen.add(i.id))

    for (const item of unique) {
      const itemId = item.id?.toString()
      if (!itemId || notifiedItems.has(itemId)) continue

      const isFree = item.price === 0 || item.price === null
      const isUGC = item.creatorType === "User" || item.creatorType === "Group"
      if (!isFree || !isUGC) continue

      notifiedItems.add(itemId)
      const imageUrl = await getItemImage(itemId)
      const rolimonsUrl = `https://www.rolimons.com/item/${itemId}`
      const itemUrl = `https://www.roblox.com/catalog/${itemId}`

      const creatorValue = item.creatorTargetId
        ? `[${item.creatorName}](${item.creatorType === "Group"
            ? `https://www.roblox.com/groups/${item.creatorTargetId}`
            : `https://www.roblox.com/users/${item.creatorTargetId}/profile`})`
        : (item.creatorName || "Unknown")

      const gameInfo = await getGameInfo(itemId)

      const fields = [
        { name: "💰 Price", value: "FREE", inline: true },
        { name: "📦 Stock", value: `${item.unitsAvailableForConsumption ?? "1"}`, inline: true },
        { name: "👤 Creator", value: creatorValue, inline: true }
      ]

      fields.push({ name: "Game", value: gameInfo ? `[${gameInfo.name}](${gameInfo.url})` : "N/A" })

      fields.push({ name: "Item", value: `<${rolimonsUrl}>` })

      const freeEmbed = {
        title: item.name,
        color: 0xED4245,
        fields: fields,
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

client.once("ready", () => {
  console.log(`✅ Bot online as ${client.user.tag}`)
  checkFreeUGC()
})

client.login(TOKEN)
