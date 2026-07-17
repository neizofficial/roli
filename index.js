require("dotenv").config()
const { Client, GatewayIntentBits, Events } = require("discord.js")
const axios = require("axios")
const cron = require("node-cron")
const http = require("http")
const fs = require("fs")
const path = require("path")

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
const NOTIFIED_FILE = path.join(__dirname, "notified.json")

let notifiedItems = new Set()
let rolimonsData = {}

const axiosConfig = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  }
}

function loadNotified() {
  try {
    if (fs.existsSync(NOTIFIED_FILE)) {
      const data = JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf8"))
      notifiedItems = new Set(data)
    }
  } catch (e) {
    console.error(e)
  }
}

function saveNotified() {
  try {
    fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...notifiedItems]))
  } catch (e) {
    console.error(e)
  }
}

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" })
  res.end("OK")
}).listen(process.env.PORT || 10000)

async function sendWebhookTo(url, payload) {
  if (!url) return
  try {
    await axios.post(url, payload)
  } catch (e) {
    console.error("Webhook error:", e.response?.status)
  }
}

async function fetchRolimonsData() {
  try {
    const res = await axios.get("https://www.rolimons.com/itemapi/itemdetails", axiosConfig)
    if (res.data?.success && res.data?.items) rolimonsData = res.data.items
  } catch (e) {
    console.error("Rolimons error:", e.message)
  }
}

async function getItemImage(itemId) {
  try {
    const res = await axios.get(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${itemId}&size=420x420&format=Png`,
      axiosConfig
    )
    return res.data?.data?.[0]?.imageUrl || null
  } catch (e) {
    return null
  }
}

async function getGameInfo(itemId) {
  try {
    const detailsRes = await axios.get(
      `https://economy.roblox.com/v2/assets/${itemId}/details`,
      axiosConfig
    )
    const saleLocation = detailsRes.data?.SaleLocation
    const universeId = saleLocation?.UniverseIds?.[0] ?? saleLocation?.universeIds?.[0]
    if (!universeId) return null
    const gameRes = await axios.get(
      `https://games.roblox.com/v1/games?universeIds=${universeId}`,
      axiosConfig
    )
    const gameData = gameRes.data?.data?.[0]
    if (!gameData?.rootPlaceId) return null
    return {
      name: gameData.name || "Game",
      url: `https://www.roblox.com/games/${gameData.rootPlaceId}`
    }
  } catch (e) {
    return null
  }
}

function getRolimonsInfo(itemId) {
  const data = rolimonsData[itemId]
  if (!data) return null
  const [_, __, rap, value, ___, demand] = data
  const demandMap = { "-1": "None", "0": "Terrible", "1": "Low", "2": "Normal", "3": "High", "4": "Amazing" }
  return {
    rap: rap > 0 ? rap : "N/A",
    value: value > 0 ? value : "N/A",
    demand: demandMap[demand.toString()] || "None"
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "Unknown"
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

async function checkFreeUGC() {
  try {
    if (Object.keys(rolimonsData).length === 0) await fetchRolimonsData()
    const urls = [
      "https://catalog.roblox.com/v1/search/items/details?Category=11&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2&SortAggregation=1",
      "https://catalog.roblox.com/v1/search/items/details?Category=3&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2&SortAggregation=1",
      "https://catalog.roblox.com/v1/search/items/details?Category=4&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2&SortAggregation=1",
      "https://catalog.roblox.com/v1/search/items/details?Category=8&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2&SortAggregation=1",
      "https://catalog.roblox.com/v1/search/items/details?Category=12&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2&SortAggregation=1"
    ]
    const results = await Promise.all(
      urls.map((u) => axios.get(u, axiosConfig).catch(() => null))
    )
    const allItems = results.flatMap((r) => r?.data?.data ?? [])
    const seen = new Set()
    const unique = allItems.filter((i) => !seen.has(i.id) && seen.add(i.id))
    let newNotifications = 0
    for (const item of unique) {
      if (newNotifications >= 10) break
      const itemId = item.id?.toString()
      if (!itemId || notifiedItems.has(itemId)) continue
      const isFree = item.price === 0 || item.price === null
      const isUGC = item.creatorType === "User" || item.creatorType === "Group"
      const stock = item.unitsAvailableForConsumption
      const isLimited = stock != null && stock > 0
      if (!isFree || !isUGC || !isLimited) continue
      notifiedItems.add(itemId)
      newNotifications++
      const imageUrl = await getItemImage(itemId)
      const rolimonsUrl = `https://www.rolimons.com/item/${itemId}`
      const itemUrl = `https://www.roblox.com/catalog/${itemId}`
      const creatorValue = item.creatorTargetId
        ? `[${item.creatorName}](${item.creatorType === "Group" ? `https://www.roblox.com/groups/${item.creatorTargetId}` : `https://www.roblox.com/users/${item.creatorTargetId}/profile`})`
        : item.creatorName || "Unknown"
      const gameInfo = await getGameInfo(itemId)
      const rolimonsInfo = getRolimonsInfo(itemId)
      const createdDate = formatDate(item.itemCreatedUtc || item.createdUtc)
      const fields = [
        { name: "💰 Price", value: "FREE", inline: true },
        { name: "📦 Stock", value: `${stock}`, inline: true },
        { name: "👤 Creator", value: creatorValue, inline: true },
        { name: "📅 Created", value: createdDate, inline: true }
      ]
      if (rolimonsInfo) {
        fields.push({ name: "📊 RAP", value: rolimonsInfo.rap.toString(), inline: true })
        fields.push({ name: "💎 Value", value: rolimonsInfo.value.toString(), inline: true })
        fields.push({ name: "📈 Demand", value: rolimonsInfo.demand, inline: true })
      }
      fields.push({ name: "🎮 Game", value: gameInfo ? `[${gameInfo.name}](${gameInfo.url})` : "N/A" })
      fields.push({ name: "🔗 Item", value: `[${item.name}](${rolimonsUrl})` })
      await sendWebhookTo(FREE_WEBHOOK, {
        content: `<@&${FREE_ROLE_ID}>`,
        embeds: [{
          title: item.name,
          color: 0xED4245,
          fields: fields,
          thumbnail: { url: imageUrl || ROSE_ICON_URL },
          timestamp: new Date().toISOString(),
          url: itemUrl
        }]
      })
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
    if (newNotifications > 0) saveNotified()
  } catch (e) {
    console.error(e.message)
  }
}

cron.schedule("*/30 * * * *", fetchRolimonsData)
cron.schedule("* * * * *", checkFreeUGC)

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ ${readyClient.user.tag} online`)
  loadNotified()
  fetchRolimonsData()
  checkFreeUGC()
})

client.login(TOKEN)
