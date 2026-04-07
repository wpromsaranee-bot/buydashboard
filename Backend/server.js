const express = require("express");
const axios = require("axios");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ================== AXIOS (🔥 FIX YAHOO BLOCK) ==================
const axiosInstance = axios.create({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
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

if (fs.existsSync("history.json")) {
  history = JSON.parse(fs.readFileSync("history.json"));
}

// ================== FETCH ==================

async function getSET(prev) {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/^SET.BK";
    const res = await fetchWithRetry(url);

    const result = res.data?.chart?.result?.[0];
    if (!result) throw new Error("Invalid SET data");

    const price = result.meta?.regularMarketPrice;

    console.log("SET:", price);

    return { price: price || prev?.set || 0 };

  } catch (err) {
    console.log("SET ERROR:", err.message);
    return { price: prev?.set || 0 };
  }
}

async function getTHB(prev) {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/THB=X";
    const res = await fetchWithRetry(url);

    const result = res.data?.chart?.result?.[0];
    if (!result) throw new Error("Invalid THB data");

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
    const requests = Object.values(stocks).map(s =>
      fetchWithRetry(`https://query1.finance.yahoo.com/v8/finance/chart/${s}`)
    );

    const responses = await Promise.all(requests);

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
      totalVolume: prevBigCap ? Object.values(prevBigCap).reduce((a,b)=>a+(b.volume||0),0) : 0
    };
  }
}

// ================== FOREIGN ==================

function getForeignFlowProxy(set, prevSet, thb, prevThb) {
  let score = 0;

  if (set > prevSet) score += 1;
  else if (set < prevSet) score -= 1;

  if (thb < prevThb) score += 1;
  else if (thb > prevThb) score -= 1;

  return score * 1000;
}

// ================== SCORE ==================

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

// ================== ACTION ==================

function getTrend(curr, prev) {
  if (!prev) return "→";
  if (curr > prev) return "↑";
  if (curr < prev) return "↓";
  return "→";
}

function getAction(today, prev) {
  if (!prev) return { action: "WAIT", confidence: 0 };

  const setTrend = getTrend(today.set, prev.set);
  const foreignTrend = getTrend(today.foreign, prev.foreign);
  const thbTrend = getTrend(today.thb, prev.thb);
  const volumeTrend = getTrend(today.volume, prev.volume);

  let smartScore = 0;

  if (setTrend === "↑") smartScore += 1;
  if (setTrend === "↓") smartScore -= 1;

  if (foreignTrend === "↑") smartScore += 2;
  if (foreignTrend === "↓") smartScore -= 2;

  if (thbTrend === "↓") smartScore += 1;
  if (thbTrend === "↑") smartScore -= 1;

  if (volumeTrend === "↑") smartScore += 1;
  if (volumeTrend === "↓") smartScore -= 1;

  let action = "WAIT";

  if (smartScore >= 3 && setTrend === "↑" && foreignTrend === "↑" && volumeTrend === "↑") {
    action = "BUY NOW";
  } 
  else if (setTrend === "↑" && foreignTrend === "↓") {
    action = "DANGER";
  } 
  else if (smartScore >= 2 && (volumeTrend === "↓" || foreignTrend === "↓")) {
    action = "TAKE PROFIT";
  }

  const confidence = Math.min(100, Math.abs(smartScore) * 20);

  return { action, confidence };
}

// ================== 🔥 RUN DAILY ==================

async function runDaily() {
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

  const todayStr = new Date(Date.now() + 7*60*60*1000)
    .toISOString().slice(0, 10);

  const today = {
    date: todayStr,
    set: setData.price,
    volume: bigcapData.totalVolume,
    thb,
    foreign,
    bigcap: bigcapData.stocks
  };

  const analysis = calculateScore(today, prev);
  const decision = getAction(today, prev);

  const finalData = {
    ...today,
    score: analysis.score,
    signal: analysis.signal,
    entry: "LIVE",
    action: decision.action,
    confidence: decision.confidence
  };

  history = history.filter(d => d.date !== todayStr);
  history.push(finalData);

  if (history.length > 60) history.shift();

  fs.writeFileSync("history.json", JSON.stringify(history, null, 2));

  console.log("✅ SAVE:", finalData);

  return finalData;
}

// ================== API ==================

app.get("/dashboard", async (req, res) => {
  try {
    await runDaily(); // 🔥 สำคัญสุด (auto update)

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
  let { start, end } = req.query;

  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;

  const filtered = history.filter(item => {
    const d = new Date(item.date);
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
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