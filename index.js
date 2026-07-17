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
const ROSE_ICON_URL = "https://i.imgur.com/your-uploaded-icon.png"
const NOTIFIED_FILE = path.join(__dirname, "notified.json")

let notifiedItems = new Set()
let rolimonsData = {}
let initialized = false

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
  } catch (e) {}
}

function saveNotified() {
  try {
    fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...notifiedItems]))
  } catch (e) {}
}

http.createServer((req, res) => { res.writeHead(200); res.end("Live"); }).listen(process.env.PORT || 10000)

async function fetchRolimons() {
  try {
    const res = await axios.get("https://www.rolimons.com/itemapi/itemdetails", axiosConfig)
    if (res.data?.success) rolimonsData = res.data.items
  } catch (e) {}
}

async function checkFreeUGC() {
  try {
    console.log("Checking for items...")
    const urls = [
      "https://catalog.roblox.com/v1/search/items/details?Category=11&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2",
      "https://catalog.roblox.com/v1/search/items/details?Category=3&Limit=30&MinPrice=0&MaxPrice=0&salesTypeFilter=1&SortType=2"
    ]

    const results = await Promise.all(urls.map(u => axios.get(u, axiosConfig).catch(() => null)))
    const items = results.flatMap(r => r?.data?.data ?? [])
    const unique = Array.from(new Map(items.map(i => [i.id, i])).values())
    
    let addedAny = false
    for (const item of unique) {
      const id = item.id.toString()
      if (notifiedItems.has(id)) continue

      const isFree = item.price === 0 || item.price === null
      const hasStock = item.unitsAvailableForConsumption > 0

      if (isFree && hasStock) {
        notifiedItems.add(id)
        addedAny = true

        if (!initialized) {
          console.log(`Stored existing item: ${item.name}`)
          continue
        }

        const thumb = await axios.get(`https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png`, axiosConfig).catch(() => null)
        const img = thumb?.data?.data?.[0]?.imageUrl || ROSE_ICON_URL

        await axios.post(FREE_WEBHOOK, {
          content: `<@&${FREE_ROLE_ID}>`,
          embeds: [{
            title: item.name,
            url: `https://www.roblox.com/catalog/${id}`,
            color: 0xED4245,
            fields: [
              { name: "📦 Stock", value: `${item.unitsAvailableForConsumption}`, inline: true },
              { name: "👤 Creator", value: item.creatorName, inline: true }
            ],
            thumbnail: { url: img },
            timestamp: new Date().toISOString()
          }]
        }).catch(() => null)
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    if (addedAny) saveNotified()
    initialized = true
  } catch (e) {}
}

cron.schedule("*/30 * * * *", fetchRolimons)
cron.schedule("* * * * *", checkFreeUGC)

client.once(Events.ClientReady, async () => {
  console.log(`✅ ${client.user.tag} Online`)
  
  // TEST MESSAGE
  await axios.post(FREE_WEBHOOK, {
    content: "🛠️ **System Check:** Bot is online and monitoring for new Free Limiteds!"
  }).catch(e => console.log("Webhook test failed:", e.message))

  loadNotified()
  await fetchRolimons()
  checkFreeUGC()
})

client.login(TOKEN)
