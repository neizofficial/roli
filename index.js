require("dotenv").config()
const { Client, GatewayIntentBits, Events } = require("discord.js")
const axios = require("axios")
const cron = require("node-cron")
const http = require("http")
const fs = require("fs")
const path = require("path")

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
})

const TOKEN = process.env.DISCORD_TOKEN
const FREE_WEBHOOK = process.env.FREE_WEBHOOK
const FREE_ROLE_ID = "1509514820913729557"
const NOTIFIED_FILE = path.join(__dirname, "notified.json")

let notifiedItems = new Set()
let rolimonsData = {}
let initialized = false

const axiosConfig = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  }
}

// Ensure notified file exists
function loadNotified() {
  try {
    if (fs.existsSync(NOTIFIED_FILE)) {
      const data = JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf8"))
      notifiedItems = new Set(data)
    }
  } catch (e) { console.log("Error loading notified file") }
}

function saveNotified() {
  try {
    fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...notifiedItems]))
  } catch (e) { console.log("Error saving notified file") }
}

// Keep-alive server
http.createServer((req, res) => { res.writeHead(200); res.end("Live"); }).listen(process.env.PORT || 10000)

async function fetchRolimons() {
  try {
    console.log("Fetching Rolimons Data...")
    const res = await axios.get("https://www.rolimons.com/itemapi/itemdetails", axiosConfig)
    if (res.data?.success) {
      rolimonsData = res.data.items
      await checkRolimonsForFreeItems()
    }
  } catch (e) { console.error("Rolimons Fetch Error:", e.message) }
}

async function sendWebhook(item) {
  const thumb = await axios.get(`https://thumbnails.roblox.com/v1/assets?assetIds=${item.id}&size=420x420&format=Png`, axiosConfig).catch(() => null)
  const img = thumb?.data?.data?.[0]?.imageUrl || ""

  await axios.post(FREE_WEBHOOK, {
    content: `<@&${FREE_ROLE_ID}>`,
    embeds: [{
      title: `🆕 Free Limited: ${item.name}`,
      url: `https://www.roblox.com/catalog/${item.id}`,
      color: 0x00FF00, // Green for free
      fields: [
        { name: "📦 Stock", value: item.stock ? `${item.stock}` : "Check Link", inline: true },
        { name: "👤 Creator", value: item.creator || "Unknown", inline: true },
        { name: "🔗 Quick Links", value: `[Catalog](https://www.roblox.com/catalog/${item.id}) | [Rolimons](https://www.rolimons.com/item/${item.id})` }
      ],
      thumbnail: { url: img },
      footer: { text: "Monitoring Rolimons & Roblox Catalog" },
      timestamp: new Date().toISOString()
    }]
  }).catch(e => console.error("Webhook Send Error:", e.message))
}

// Scans Rolimons Database for items with price 0
async function checkRolimonsForFreeItems() {
  let addedAny = false
  for (const [id, details] of Object.entries(rolimonsData)) {
    // Rolimons Data Structure: [name, acronym, rap, value, default_value, demand, trend, item_type, projected, hyped, rare, price]
    const name = details[0]
    const itemType = details[7] // 2 = UGC Limited
    const price = details[11]

    if (itemType === 2 && price === 0) {
      if (!notifiedItems.has(id)) {
        notifiedItems.add(id)
        addedAny = true

        // Only send if the bot has already finished its first scan (prevents spamming old items)
        if (initialized) {
          console.log(`Found free item on Rolimons: ${name}`)
          await sendWebhook({ id, name, creator: "Rolimons Update", stock: "Unknown" })
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    }
  }
  if (addedAny) saveNotified()
}

// Scans Roblox Catalog for active 0 Robux items
async function checkCatalogAPI() {
  try {
    console.log("Checking Roblox Catalog...")
    const urls = [
      "https://catalog.roblox.com/v1/search/items/details?Category=11&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2",
      "https://catalog.roblox.com/v1/search/items/details?Category=3&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2"
    ]

    const results = await Promise.all(urls.map(u => axios.get(u, axiosConfig).catch(() => null)))
    const items = results.flatMap(r => r?.data?.data ?? [])
    
    let addedAny = false
    for (const item of items) {
      const id = item.id.toString()
      if (notifiedItems.has(id)) continue

      // Extra check: ensure it is actually a Limited and Price is 0
      if (item.price === 0 || item.price === null) {
        notifiedItems.add(id)
        addedAny = true

        if (initialized) {
          console.log(`Found free item on Catalog: ${item.name}`)
          await sendWebhook({ 
            id, 
            name: item.name, 
            creator: item.creatorName, 
            stock: item.unitsAvailableForConsumption || "N/A" 
          })
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    }
    if (addedAny) saveNotified()
  } catch (e) { console.error("Catalog Check Error:", e.message) }
}

// Schedules
cron.schedule("*/5 * * * *", fetchRolimons) // Update Rolimons cache every 5 mins
cron.schedule("* * * * *", checkCatalogAPI) // Check Catalog every minute for speed

client.once(Events.ClientReady, async () => {
  console.log(`✅ ${client.user.tag} is online.`)
  
  loadNotified()
  
  // Initial Run
  await fetchRolimons()
  await checkCatalogAPI()
  
  // After first check, allow webhooks to be sent
  initialized = true
  console.log("🚀 Monitoring active...")

  // System Check Message
  axios.post(FREE_WEBHOOK, {
    embeds: [{
      title: "📡 Monitoring System Active",
      description: "Bot is now scanning Rolimons and Roblox Catalog for Free Limiteds.",
      color: 0x3498DB
    }]
  }).catch(() => null)
})

client.login(TOKEN)
