const $ = (id) => document.getElementById(id);
let timer = null;
let socket = null;
let reconnectTimer = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request gagal");
  return data;
}
function showLogin() {
  $("login").classList.remove("hidden");
  $("app").classList.add("hidden");
}
function showApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  startPolling();
}
function log(message, muted = false) {
  const line = document.createElement("div");
  if (muted) line.className = "muted";
  line.textContent = "[" + new Date().toLocaleTimeString() + "] " + message;
  $("console").appendChild(line);
  $("console").scrollTop = $("console").scrollHeight;
  while ($("console").children.length > 250) $("console").firstChild.remove();
}
function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + " MB";
  return (n / 1024 ** 3).toFixed(2) + " GB";
}
function percent(value, limit) {
  return limit > 0 ? Math.max(0, Math.min(100, value / limit * 100)) : 0;
}
function setBar(id, value) { $(id).style.width = Math.max(0, Math.min(100, value || 0)) + "%"; }

async function refresh() {
  try {
    const data = await api("/api/server");
    const server = data.server || {};
    const state = data.resources?.current_state || "unknown";
    const resource = data.resources?.resources || {};
    $("serverName").textContent = server.name || "Pterodactyl Server";
    $("serverMeta").textContent = (server.description || "Server control panel") + " · " + (server.identifier || "");
    $("identifier").textContent = server.identifier || "—";
    $("node").textContent = server.node ?? "—";
    $("egg").textContent = server.egg ?? "—";
    $("detailStatus").textContent = state;
    $("cpuLimit").textContent = server.limits?.cpu ? server.limits.cpu + "%" : "Unlimited";
    $("ramLimit").textContent = server.limits?.memory ? formatBytes(server.limits.memory * 1024 * 1024) : "Unlimited";
    $("status").textContent = "● " + state;
    $("status").style.color = state === "running" ? "var(--green)" : state === "offline" ? "var(--red)" : "var(--yellow)";

    const cpu = Number(resource.cpu_absolute || 0);
    const memory = Number(resource.memory_bytes || 0);
    const disk = Number(resource.disk_bytes || 0);
    const ramLimit = Number(server.limits?.memory || 0) * 1024 * 1024;
    const diskLimit = Number(server.limits?.disk || 0) * 1024 * 1024;
    $("cpu").textContent = cpu.toFixed(1) + "%";
    setBar("cpuBar", cpu);
    $("memory").textContent = formatBytes(memory);
    $("memoryFoot").textContent = ramLimit ? "Dari " + formatBytes(ramLimit) : "Batas memori tidak terbatas";
    setBar("memoryBar", percent(memory, ramLimit));
    $("disk").textContent = formatBytes(disk);
    $("diskFoot").textContent = diskLimit ? "Dari " + formatBytes(diskLimit) : "Batas disk tidak terbatas";
    setBar("diskBar", percent(disk, diskLimit));
    const traffic = Number(resource.network_rx_bytes || 0) + Number(resource.network_tx_bytes || 0);
    $("network").textContent = formatBytes(traffic);
    setBar("networkBar", Math.min(100, traffic / (100 * 1024 * 1024) * 100));
  } catch (error) {
    if (/sesi|login/i.test(error.message)) {
      stopPolling();
      showLogin();
    } else log(error.message, true);
  }
}
function startPolling() {
  if (timer) clearInterval(timer);
  refresh();
  timer = setInterval(refresh, 5000);
}
function stopPolling() {
  if (timer) clearInterval(timer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  timer = null;
  reconnectTimer = null;
  if (socket) socket.close();
  socket = null;
}
async function connectConsole() {
  try {
    const payload = await api("/api/websocket");
    const ws = payload.data;
    if (!ws?.socket || !ws?.token) throw new Error("Data WebSocket tidak lengkap.");
    if (socket) socket.close();
    socket = new WebSocket(ws.socket);
    socket.onopen = () => socket.send(JSON.stringify({ event: "auth", args: [ws.token] }));
    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.event === "auth success") {
        socket.send(JSON.stringify({ event: "send logs", args: [null] }));
        log("Console tersambung.", true);
      } else if (message.event === "console output" && Array.isArray(message.args)) {
        const output = message.args[0];
        if (output) {
          const line = document.createElement("div");
          line.textContent = output;
          $("console").appendChild(line);
          $("console").scrollTop = $("console").scrollHeight;
          while ($("console").children.length > 250) $("console").firstChild.remove();
        }
      } else if (message.event === "status" && message.args?.[0]) {
        $("status").textContent = "● " + message.args[0];
        $("detailStatus").textContent = message.args[0];
      } else if (message.event === "token expiring") {
        api("/api/websocket").then((next) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: "auth", args: [next.data.token] }));
        }).catch((error) => log("Gagal memperbarui token console: " + error.message, true));
      }
    };
    socket.onclose = () => {
      if (!$("app").classList.contains("hidden")) {
        log("Console terputus; mencoba menyambungkan ulang…", true);
        reconnectTimer = setTimeout(connectConsole, 5000);
      }
    };
    socket.onerror = () => log("Koneksi console bermasalah.", true);
  } catch (error) { log("Console: " + error.message, true); }
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginError").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    showApp();
    connectConsole();
  } catch (error) { $("loginError").textContent = error.message; }
});
$("logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  stopPolling();
  showLogin();
});
$("refresh").addEventListener("click", refresh);
document.querySelectorAll("[data-power]").forEach((button) => {
  button.addEventListener("click", async () => {
    const signal = button.dataset.power;
    if (signal === "stop" && !confirm("Yakin ingin menghentikan server?")) return;
    button.disabled = true;
    try {
      await api("/api/power", { method: "POST", body: JSON.stringify({ signal }) });
      log("Power action dikirim: " + signal);
      setTimeout(refresh, 1500);
    } catch (error) { log("Power action gagal: " + error.message); }
    finally { button.disabled = false; }
  });
});
$("commandForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const command = $("command").value.trim();
  if (!command) return;
  try {
    await api("/api/command", { method: "POST", body: JSON.stringify({ command }) });
    log("> " + command);
    $("command").value = "";
  } catch (error) { log("Command gagal: " + error.message); }
});
api("/api/me").then(() => { showApp(); connectConsole(); }).catch(showLogin);
