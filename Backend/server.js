const express = require("express");
const axios = require("axios");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ================== ROOT (กัน Cannot GET /) ==================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "🔥 SET Dashboard API Running",
    endpoints: ["/dashboard", "/daily-run", "/history-range"]
  });
});

// ================== AXIOS ==================
const axiosInstance = axios.create({
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
    "Connection": "keep-alive"
  },
  timeout: 10000
});

// ================== RETRY ==================
async function fetchWithRetry(url, retries = 3) {
  try {
    return await axiosInstance.get(url);
  } catch (err) {
    if (retries > 0) {
      console.log("🔁 Retry:", url);
      await new Promise(r => setTimeout(r, 1000));
      return fetchWithRetry(url, retries - 1);
    }
    throw err;
  }
}

// ================== STORAGE ==================
let history = [];

const FILE_PATH = "history.json";

// 🔥 load แบบ safe
function loadHistory() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH);
      history = JSON.parse(raw);

      // กันไฟล์พัง
      if (!Array.isArray(history)) history = [];
    }
  } catch (err) {
    console.log("LOAD ERROR:", err.message);
    history = [];
  }
}

// 🔥 save แบบ safe
function saveHistory() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(history, null, 2));
  } catch (err) {
    console.log("SAVE ERROR:", err.message);
  }
}

// โหลดตอน start
loadHistory();

// ================== FETCH ==================

async function getSET(prev) {
  try {
    const res = await fetchWithRetry("https://query1.finance.yahoo.com/v8/finance/chart/^SET.BK");
    const result = res.data?.chart?.result?.[0];
    if (!result) throw new Error("SET invalid");

    const price = result.meta?.regularMarketPrice;
    return { price: price || prev?.set || 0 };

  } catch (err) {
    console.log("SET ERROR:", err.message);
    return { price: prev?.set || 0 };
  }
}

async function getTHB(prev) {
  try {
    const res = await fetchWithRetry("https://query1.finance.yahoo.com/v8/finance/chart/THB=X");
    const result = res.data?.chart?.result?.[0];
    if (!result) throw new Error("THB invalid");

    return result.meta?.regularMarketPrice || prev?.thb || 0;

  } catch {
    return prev?.thb || 0;
  }
}

// ================== BIGCAP ==================

async function getBigCap(prevBigCap) {
  const stocks = {
    PTT: "PTT.BK",
    AOT: "AOT.BK",
    KBANK: "KBANK.BK",
    CPALL: "CPALL.BK",
    ADVANC: "ADVANC.BK"
  };

  try {
    const responses = await Promise.all(
      Object.values(stocks).map(s =>
        fetchWithRetry(`https://query1.finance.yahoo.com/v8/finance/chart/${s}`)
      )
    );

    const result = {};
    let totalVolume = 0;

    Object.keys(stocks).forEach((name, i) => {
      const data = responses[i].data?.chart?.result?.[0];
      if (!data) return;

      const price = data.meta?.regularMarketPrice || 0;
      const volume = data.meta?.regularMarketVolume || 0;

      totalVolume += volume;

      let trend = "→";
      if (prevBigCap && prevBigCap[name]) {
        if (price > prevBigCap[name].price) trend = "↑";
        else if (price < prevBigCap[name].price) trend = "↓";
      }

      result[name] = { price, trend, volume };
    });

    return { stocks: result, totalVolume };

  } catch (err) {
    console.log("BIGCAP ERROR:", err.message);
    return {
      stocks: prevBigCap || {},
      totalVolume: prevBigCap
        ? Object.values(prevBigCap).reduce((a, b) => a + (b.volume || 0), 0)
        : 0
    };
  }
}

// ================== CALC ==================

function getForeignFlowProxy(set, prevSet, thb, prevThb) {
  let score = 0;

  if (set > prevSet) score++;
  else if (set < prevSet) score--;

  if (thb < prevThb) score++;
  else if (thb > prevThb) score--;

  return score * 1000;
}

function calculateScore(today, prev) {
  if (!prev) return { score: 0, signal: "SIDEWAY" };

  let score = 0;

  if (today.set > prev.set) score++;
  else if (today.set < prev.set) score--;

  let up = 0, down = 0;
  for (let key in today.bigcap) {
    if (today.bigcap[key].trend === "↑") up++;
    if (today.bigcap[key].trend === "↓") down++;
  }

  if (up > down) score++;
  else if (down > up) score--;

  if (today.foreign > 0) score++;
  else if (today.foreign < 0) score--;

  if (today.volume > prev.volume) score++;
  else if (today.volume < prev.volume) score--;

  let signal = "SIDEWAY";
  if (score >= 3) signal = "BULL";
  if (score <= -3) signal = "BEAR";

  return { score, signal };
}

// ================== RUN DAILY ==================
async function runDaily() {
  console.log("🔥 RUN DAILY");

  const prev = history[history.length - 1];

  const setData = await getSET(prev);
  const thb = await getTHB(prev);
  const bigcapData = await getBigCap(prev?.bigcap);

  const foreign = getForeignFlowProxy(
    setData.price,
    prev?.set || setData.price,
    thb,
    prev?.thb || thb
  );

  const todayStr = new Date(Date.now() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const today = {
    date: todayStr,
    set: setData.price,
    volume: bigcapData.totalVolume,
    thb,
    foreign,
    bigcap: bigcapData.stocks
  };

  const analysis = calculateScore(today, prev);

  const finalData = {
    ...today,
    score: analysis.score,
    signal: analysis.signal,
    entry: "LIVE"
  };

  // 🔥 FIX สำคัญ: update เฉพาะวันเดียว ไม่ลบทั้งก้อนมั่ว
  const index = history.findIndex(d => d.date === todayStr);

  if (index !== -1) {
    // update วันเดิม
    history[index] = finalData;
  } else {
    // เพิ่มวันใหม่
    history.push(finalData);
  }

  // 🔥 sort กันพัง
  history.sort((a, b) => new Date(a.date) - new Date(b.date));

  // 🔥 limit
  if (history.length > 60) history = history.slice(-60);

  saveHistory();

  console.log("✅ SAVE:", finalData);

  return finalData;
}

// ================== API ==================

app.get("/daily-run", async (req, res) => {
  try {
    const data = await runDaily();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

app.get("/dashboard", async (req, res) => {
  try {
    await runDaily();
    res.json({
      today: history[history.length - 1],
      history
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

app.get("/history-range", (req, res) => {
  const { start, end } = req.query;

  const filtered = history.filter(item => {
    const d = new Date(item.date);
    if (start && d < new Date(start)) return false;
    if (end && d > new Date(end)) return false;
    return true;
  });

  res.json({
    total: filtered.length,
    data: filtered
  });
});

// ================== START ==================

app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});