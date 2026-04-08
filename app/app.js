/* =========================  
STATE  
========================= */  
let skuIndex = {}  
let articleIndex = {}  
let cache = {}  
let isReady = false  
let lastScanSound = 0
let audioCtx = null

let stream = null
let isScanning = false

const MAX_RESULT = 30  

/* =========================  
ELEMENT  
========================= */  
const searchInput = document.getElementById("search")  
const resultEl = document.getElementById("result")  
const statusEl = document.getElementById("status")  

const btnCamera = document.getElementById("btnCamera")
const btnVoice = document.getElementById("btnVoice")

const video = document.getElementById("camera")
const canvas = document.getElementById("canvas")
const ctx = canvas.getContext("2d")

const scanFrame = document.getElementById("scanFrame")
const scanText = document.getElementById("scanText")
const btnClose = document.getElementById("btnClose")
const flash = document.getElementById("flash")

/* =========================  
OVERLAY (HIGHLIGHT BOX)
========================= */
const overlay = document.createElement("canvas")
const overlayCtx = overlay.getContext("2d")

overlay.style.position = "fixed"
overlay.style.inset = "0"
overlay.style.zIndex = "1002"
overlay.style.pointerEvents = "none"

document.body.appendChild(overlay)

/* =========================  
UTIL  
========================= */  
function normalize(val) {  
  return (val || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/* =========================  
SOUND  
========================= */
function playBeep(freq = 900, duration = 120) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    }

    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()

    osc.connect(gain)
    gain.connect(audioCtx.destination)

    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime)

    osc.start()
    osc.stop(audioCtx.currentTime + duration / 1000)
  } catch {}
}

/* =========================  
VOICE (TIDAK DIUBAH)
========================= */
let recognition = null
let isListening = false

function wordsToNumber(text) {
  const map = { nol:"0", kosong:"0", satu:"1", dua:"2", tiga:"3", empat:"4", lima:"5", enam:"6", tujuh:"7", delapan:"8", sembilan:"9" }
  return text.toLowerCase().split(" ").map(w => map[w] ?? w).join("")
}

function aiFilterSKUPro(words) {
  let best = ""
  let bestScore = -999

  words.forEach(w => {
    const text = w.text || ""
    const conf = w.confidence || 0

    const nums = text.match(/\d+/g)
    if (!nums) return

    nums.forEach(num => {
      let score = 0
      const len = num.length

      // 🔥 PRIORITAS SKU (BUKAN BARCODE)
      if (len >= 6 && len <= 10) score += 10
      else if (len === 5) score += 5
      else if (len >= 11) score -= 8 // ⛔ kemungkinan barcode
      else if (len < 5) score -= 10

      // 🔥 FILTER HARGA / DISKON
      if (Number(num) < 1000) score -= 5
      if (Number(num) > 9999999999) score -= 5

      // 🔥 CONFIDENCE OCR
      if (conf > 80) score += 3
      else if (conf < 50) score -= 5

      // 🔥 POSISI DI TENGAH FRAME (PRIORITAS)
      const centerX = (w.bbox.x0 + w.bbox.x1) / 2
      const centerY = (w.bbox.y0 + w.bbox.y1) / 2

      const screenCenterX = window.innerWidth / 2
      const screenCenterY = window.innerHeight / 2

      const dist = Math.hypot(centerX - screenCenterX, centerY - screenCenterY)

      if (dist < 150) score += 5

      // 🔥 BONUS: angka biasanya SKU (bukan desimal harga)
      if (!text.includes(".")) score += 2

      if (score > bestScore) {
        bestScore = score
        best = num
      }
    })
  })

  return best
}

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

  recognition = new SpeechRecognition()
  recognition.lang = "id-ID"

  recognition.continuous = false
  recognition.interimResults = false
  recognition.maxAlternatives = 1

  recognition.onstart = () => {
    isListening = true
    statusEl.innerText = "🎤 Listening..."
  }

  recognition.onresult = (e) => {
  let text = ""

  for (let i = 0; i < e.results.length; i++) {
    text += e.results[i][0].transcript + " "
  }

  let processed = wordsToNumber(text)

  console.log("VOICE:", processed) // 🔥 DEBUG

  if (!processed) return

  searchInput.value = processed
  searchInput.dispatchEvent(new Event("input"))
}

  recognition.onend = () => {
    isListening = false
    statusEl.innerText = "Voice selesai"
  }
}

btnVoice?.addEventListener("click", () => {
  if (!recognition) return alert("Voice tidak support")

  if (isListening) recognition.stop()
  else recognition.start()
})

/* =========================  
CAMERA START
========================= */
btnCamera.addEventListener("click", async () => {
  if (stream) return

  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  })

  video.srcObject = stream
  video.muted = true
  video.play()

  overlay.width = window.innerWidth
  overlay.height = window.innerHeight

  video.classList.add("active")
  document.body.classList.add("camera-open")

  scanFrame.classList.add("active")
  scanText.classList.add("active")
  btnClose.classList.add("active")

  statusEl.innerText = "Arahkan SKU ke frame"
})

/* =========================  
AUTO SCAN LOOP (🔥 BARU)
========================= */
function isInsideFrame(box) {
  const frame = scanFrame.getBoundingClientRect()
  const cx = box.x0 + (box.x1 - box.x0)/2
  const cy = box.y0 + (box.y1 - box.y0)/2

  return (
    cx > frame.left &&
    cx < frame.right &&
    cy > frame.top &&
    cy < frame.bottom
  )
}

async function scanLoop() {
  if (!stream) return

  if (isScanning) {
    requestAnimationFrame(scanLoop)
    return
  }

  isScanning = true

  try {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    ctx.drawImage(video, 0, 0)

    const result = await Tesseract.recognize(canvas, "eng")

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height)

    result.data.words.forEach(w => {
      if (!w.text.match(/\d{5,}/)) return

      const b = w.bbox

      overlayCtx.strokeStyle = "rgba(0,255,0,0.5)"
      overlayCtx.lineWidth = 2
      overlayCtx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
    })

    let keyword = aiFilterSKUPro(result.data.words)

    console.log("SCAN:", keyword) // 🔥 DEBUG

    if (keyword) {
      searchInput.value = keyword
      searchInput.dispatchEvent(new Event("input"))

      playBeep(1200, 100)

      stopCamera()
      return
    }

  } catch (err) {
    console.log("OCR ERROR:", err)
  }

  isScanning = false
  requestAnimationFrame(scanLoop)
}

/* =========================  
STOP CAMERA
========================= */
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop())
    stream = null
  }

  video.classList.remove("active")
  document.body.classList.remove("camera-open")

  scanFrame.classList.remove("active")
  scanText.classList.remove("active")
  btnClose.classList.remove("active")

  overlayCtx.clearRect(0,0,overlay.width,overlay.height)
}

btnClose?.addEventListener("click", stopCamera)

/* =========================  
START SCAN LOOP
========================= */
video.addEventListener("play", () => {
  requestAnimationFrame(scanLoop)
})

/* =========================  
STATUS PROMO  
========================= */  
function excelToDate(val) {
  if (!isNaN(val)) {
    return new Date((Number(val) - 25569) * 86400 * 1000)
  }
  return new Date(val)
}

function getStatusPromo(mulai, akhir) {
  const now = new Date()

  let start = excelToDate(mulai)
  let end = excelToDate(akhir)

  if (isNaN(start) || isNaN(end)) return "Tidak diketahui"

  // 🔥 FIX UTAMA: SET JAM
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)

  if (now < start) return "Belum aktif"
  if (now > end) return "Berakhir"
  return "Aktif"
}

function getStatusPriority(status) {
  switch (status) {
    case "Aktif": return 1
    case "Belum aktif": return 2
    case "Berakhir": return 3
    default: return 99
  }
}

function getStatusColor(status) {
  switch (status) {
    case "Aktif": return "green"
    case "Belum aktif": return "orange"
    case "Berakhir": return "red"
    default: return "gray"
  }
}

/* =========================  
PRIORITY + HIGHLIGHT  
========================= */  
function getPriority(item, keyword) {  
  const sku = normalize(item.sku)  
  const article = normalize(item.article)  
  const desc = normalize(item.deskripsi)  

  if (sku === keyword) return 1  
  if (article === keyword) return 2  
  if (sku.startsWith(keyword)) return 3  
  if (article.startsWith(keyword)) return 4  
  if (sku.includes(keyword)) return 5  
  if (article.includes(keyword)) return 6  
  if (desc.includes(keyword)) return 10  

  return 999  
}  

function highlight(text, keyword) {  
  if (!text) return "-"  
  const safe = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")  
  const regex = new RegExp(`(${safe})`, "gi")  
  return text.toString().replace(regex, `<mark>$1</mark>`)  
}  

/* =========================  
LOAD INDEX  
========================= */  
async function loadIndex() {  
  try {  
    statusEl.innerText = "Loading index..."  

    const [skuRes, articleRes] = await Promise.all([  
      fetch("./db/sku_index.json"),  
      fetch("./db/article_index.json")  
    ])  

    if (skuRes.ok) skuIndex = await skuRes.json()  
    if (articleRes.ok) articleIndex = await articleRes.json()  

    isReady = true  
    statusEl.innerText = "Siap digunakan"  
  } catch (err) {  
    console.log("❌ Index gagal:", err)  
    isReady = true  
    statusEl.innerText = "Mode fallback aktif"  
  }  
}  
loadIndex()  


let DB = []

async function loadAllData() {
  let i = 1

  while (true) {
    try {
      let res = await fetch(`./db/promo_${i}.json`) // 🔥 pakai ./ bukan ../

      if (!res.ok) break

      let data = await res.json()
      DB.push(...data)

      i++
    } catch {
      break
    }
  }

  console.log("✅ Total data loaded:", DB.length)
}

loadAllData()
/* =========================  
UTILS  
========================= */  
function formatRupiah(num) {  
  if (!num || isNaN(num)) return num  
  return "Rp " + Number(num).toLocaleString("id-ID")  
}  

function formatDiskon(val) {  
  if (!val) return "-"  
  if (!isNaN(val)) {  
    let num = Number(val)  
    return num <= 1 ? Math.round(num * 100) + "%" : num + "%"  
  }  
  return val  
}  

function getFileName(path) {  
  return path ? path.split(/[\\/]/).pop() : "-"  
}  

function formatTanggal(val) {  
  if (!val || val === 0 || val === "0") return "-"  

  if (!isNaN(val)) {  
    const excelDate = Number(val)  
    if (excelDate < 1000) return "-"  
    const date = new Date((excelDate - 25569) * 86400 * 1000)  
    return date.toLocaleDateString("id-ID", {  
      day: "2-digit",  
      month: "short",  
      year: "numeric"  
    })  
  }  

  const d = new Date(val)  
  if (isNaN(d)) return "-"  

  return d.toLocaleDateString("id-ID", {  
    day: "2-digit",  
    month: "short",  
    year: "numeric"  
  })  
}  

/* =========================  
LOAD FILE (CACHE)  
========================= */  
async function loadFile(fileIndex) {  
  try {  
    if (cache[fileIndex]) return cache[fileIndex]  

    const res = await fetch(`./db/promo_${fileIndex}.json`)  

    if (!res.ok) {
      return null // ⛔ penting (bukan [])
    }

    const data = await res.json()  
    cache[fileIndex] = data  

    return data  
  } catch {  
    return null  
  }  
}

/* =========================  
SORT FINAL  
========================= */  
function finalSort(results, keyword) {
  return results.sort((a, b) => {
    // Status dulu
    if (a._statusPriority !== b._statusPriority) {
      return a._statusPriority - b._statusPriority
    }
    // Baru relevansi search
    return a._priority - b._priority
  })
}

/* =========================  
EXACT RESULT  
========================= */  
async function getExactResults(indexList, keyword) {  
  let results = []  
  keyword = normalize(keyword)  

  for (let i of indexList) {  
    const fileIndex = Math.floor(i / 5000) + 1  
    const data = await loadFile(fileIndex)  

    const item = data[i % 5000]  
    if (!item) continue  

    const sku = normalize(item.sku)  
    const article = normalize(item.article)  

    if (sku === keyword || article === keyword) {  
      const mulai = item.fromdate || item.raw?.fromdate  
      const akhir = item.todate || item.raw?.todate  
      const status = getStatusPromo(mulai, akhir)

      results.push({  
        ...item,  
        _priority: getPriority(item, keyword),
        _status: status,
        _statusPriority: getStatusPriority(status)
      })  
    }  

    if (results.length >= MAX_RESULT) break  
  }  

  return finalSort(results, keyword)
}  

/* =========================  
RESULT DARI INDEX  
========================= */  
async function getResultsFromIndexes(indexes, keyword) {  
  let results = []  
  keyword = normalize(keyword)  

  let fileMap = {}  

  indexes.forEach(i => {  
    const fileIndex = Math.floor(i / 5000) + 1  
    if (!fileMap[fileIndex]) fileMap[fileIndex] = []  
    fileMap[fileIndex].push(i)  
  })  

  for (let fileIndex in fileMap) {  
    const data = await loadFile(fileIndex)  

    for (let i of fileMap[fileIndex]) {  
      const item = data[i % 5000]  
      if (!item) continue  

      const mulai = item.fromdate || item.raw?.fromdate  
      const akhir = item.todate || item.raw?.todate  
      const status = getStatusPromo(mulai, akhir)

      results.push({  
        ...item,  
        _priority: getPriority(item, keyword),
        _status: status,
        _statusPriority: getStatusPriority(status)
      })  

      if (results.length >= MAX_RESULT) break  
    }  
  }  

  return finalSort(results, keyword).slice(0, MAX_RESULT)
}  

/* =========================  
FULL SCAN  
========================= */  
async function fullScanSearch(keyword) {  
  let results = []  
  keyword = normalize(keyword)  

  let i = 1

  while (true) {
    const data = await loadFile(i)

    // ⛔ STOP kalau file kosong / tidak ada
    if (!data || data.length === 0) break  

    for (let item of data) {  
      const sku = normalize(item.sku)
      const article = normalize(item.article)
      const desc = normalize(item.deskripsi)

      if (
        sku.includes(keyword) ||
        article.includes(keyword) ||
        desc.includes(keyword)
      ) {
        const mulai = item.fromdate || item.raw?.fromdate  
        const akhir = item.todate || item.raw?.todate  
        const status = getStatusPromo(mulai, akhir)

        results.push({  
          ...item,  
          _priority: getPriority(item, keyword),
          _status: status,
          _statusPriority: getStatusPriority(status)
        })  
      }

      if (results.length >= MAX_RESULT) break  
    }

    if (results.length >= MAX_RESULT) break  

    i++
  }

  return finalSort(results, keyword).slice(0, MAX_RESULT)
}

/* =========================  
SEARCH ENGINE  
========================= */  
async function searchData(keyword) {  
  let keywords = keyword
    .toLowerCase()
    .split(" ")
    .map(k => normalize(k))
    .filter(k => k)

  if (!keywords.length) return []

  keyword = keywords[0]

  // ✅ EXACT MATCH DULU
  if (skuIndex[keyword]) {
    return await getExactResults(skuIndex[keyword], keyword)
  }

  if (articleIndex[keyword]) {
    return await getExactResults(articleIndex[keyword], keyword)
  }

  let indexes = new Set()  
  let prefix = keyword.slice(0, 3)  

  // ✅ CARI DARI SKU INDEX
  for (let key in skuIndex) {  
    if (!key.startsWith(prefix)) continue  

    if (key.startsWith(keyword)) {  
      skuIndex[key].forEach(i => {  
        if (indexes.size < MAX_RESULT) indexes.add(i)  
      })  
    }  

    if (indexes.size >= MAX_RESULT) break  
  }  

  // ✅ CARI DARI ARTICLE INDEX (SUDAH DI POSISI BENAR)
  for (let key in articleIndex) {  
    if (!key.startsWith(prefix)) continue  

    if (key.startsWith(keyword)) {  
      articleIndex[key].forEach(i => {  
        if (indexes.size < MAX_RESULT) indexes.add(i)  
      })  
    }  

    if (indexes.size >= MAX_RESULT) break  
  }

  // ✅ JIKA ADA HASIL DARI INDEX
  if (indexes.size > 0) {
    return await getResultsFromIndexes(indexes, keyword)
  }

  // ✅ FALLBACK KE FULL SCAN
  return await fullScanSearch(keyword)
}

/* =========================  
RENDER  
========================= */  
function render(data) {  
  resultEl.innerHTML = ""  

  if (!data || data.length === 0) {  
    resultEl.innerHTML = "<p>Data tidak ditemukan</p>"  
    return  
  }  

  data.forEach(item => {  
    const diskon = formatDiskon(item.diskon || item.raw?.diskon)  

    const mulai = item.fromdate || item.raw?.fromdate || "-"  
    const akhir = item.todate || item.raw?.todate || "-"  

    const status = item._status || "Tidak diketahui"
    const statusColor = getStatusColor(status)

    const el = document.createElement("div")  
    el.className = "card"  

    el.innerHTML = `  
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div><b>${highlight(item.deskripsi, searchInput.value)}</b></div>
        <div style="
          background:${statusColor};
          color:white;
          padding:4px 8px;
          border-radius:6px;
          font-size:12px;
          font-weight:bold;
        ">
          ${status}
        </div>
      </div>

      <div>Brand: ${item.brand || "-"}</div>  
      <div>SKU: ${highlight(item.sku, searchInput.value)}</div>  
      <div>Article: ${highlight(item.article, searchInput.value)}</div>  

      <div>Harga Normal: ${formatRupiah(item.harga_normal)}</div>  

      <div style="color:red;font-weight:bold">  
        Harga Promo: ${  
          !isNaN(item.harga_promo)  
            ? formatRupiah(item.harga_promo)  
            : item.harga_promo || "-"  
        }  
      </div>  

      <div style="color:green;font-weight:bold">  
        Diskon: ${diskon}  
      </div>  

      <div>  
        Berlaku: ${formatTanggal(mulai)} - ${formatTanggal(akhir)}  
      </div>  

      <div><b>Acara:</b> ${item.acara || item.raw?.acara || "-"}</div>  
      <div><b>Sumber:</b> ${getFileName(item.source)}</div>  
    `  

    resultEl.appendChild(el)  
  })  
}  

/* =========================  
EVENT  
========================= */  
let timer  

searchInput.addEventListener("input", e => {  
  clearTimeout(timer)  

  const keyword = e.target.value  

  if (!isReady) {  
    statusEl.innerText = "Loading..."  
    return  
  }  

  timer = setTimeout(async () => {  
    if (!keyword.trim()) {  
      resultEl.innerHTML = ""  
      statusEl.innerText = "Ketik untuk mencari"  
      return  
    }  

    statusEl.innerText = "Mencari..."  

    const result = await searchData(keyword)  

    render(result)  

    statusEl.innerText = `Ditemukan ${result.length} data`  
  }, 200)  
})  

/* =========================  
AUTO UPDATE  
========================= */  
let lastUpdate = null  

setInterval(async () => {  
  try {  
    const res = await fetch("./db/sku_index.json?t=" + Date.now())  
    const res2 = await fetch("./db/article_index.json?t=" + Date.now())  

    const text = await res.text()  
    const text2 = await res2.text()  

    if (lastUpdate && lastUpdate !== (text + text2)) {  
      console.log("🔄 Data berubah, reload...")  
      location.reload()  
    }  

    lastUpdate = text + text2  
  } catch (err) {  
    console.log("❌ Gagal cek update")  
  }  
}, 300000)

/* =========================
AUTO HIDE SCAN BAR (SCROLL)
========================= */

const scanBar = document.getElementById("scanBar")

let lastScrollY = window.scrollY
let tickingScroll = false

function handleScrollUI() {
  const currentScrollY = window.scrollY

  // ❗ kalau kamera aktif → jangan hide
  if (stream) {
    scanBar.classList.remove("hide")
    return
  }

  // scroll ke bawah → hide
  if (currentScrollY > lastScrollY + 10) {
    scanBar.classList.add("hide")
  }
  // scroll ke atas → show
  else if (currentScrollY < lastScrollY - 10) {
    scanBar.classList.remove("hide")
  }

  // ❗ kalau di paling atas → selalu tampil
  if (currentScrollY < 50) {
    scanBar.classList.remove("hide")
  }

  lastScrollY = currentScrollY
  tickingScroll = false
}

window.addEventListener("scroll", () => {
  if (!tickingScroll) {
    requestAnimationFrame(handleScrollUI)
    tickingScroll = true
  }
})