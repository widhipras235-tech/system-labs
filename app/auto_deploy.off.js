const { execSync } = require("child_process")
const chokidar = require("chokidar")

console.log("👀 Monitoring folder excel...")

let isProcessing = false

function runDeploy() {
  if (isProcessing) return
  isProcessing = true

  console.log("⚙️ Perubahan terdeteksi, mulai proses...")

  try {
    // 1. Convert
    execSync("node convert_smart.js", { stdio: "inherit" })

    // 2. Git add
    execSync("git add .")

    // 3. Commit
    const msg = `auto update ${new Date().toLocaleString()}`
    execSync(`git commit -m "${msg}"`)

    // 4. Push
    execSync("git push")

    console.log("🚀 AUTO DEPLOY BERHASIL")
  } catch (err) {
    console.log("❌ ERROR:", err.message)
  }

  setTimeout(() => {
    isProcessing = false
  }, 3000)
}

/* =========================
WATCH EXCEL FOLDER
========================= */
chokidar.watch("./excel", {
  ignored: /(^|[\/\\])\../,
  persistent: true
})
.on("add", runDeploy)
.on("change", runDeploy)
.on("unlink", runDeploy)