import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer
} from "recharts";

const Card = ({ children }) => (
  <div style={{
    border: "1px solid #ddd",
    borderRadius: "12px",
    padding: "16px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    background: "#fff"
  }}>
    {children}
  </div>
);

const formatNumber = (num) => {
  if (num === null || num === undefined) return "-";
  return num.toLocaleString();
};

// 🔥 dynamic scale
const getDomain = (data, key) => {
  if (!data || data.length === 0) return [0, 100];

  const values = data.map(d => d[key]).filter(v => v != null);

  if (values.length === 0) return [0, 100];

  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) return [min - 10, max + 10];

  const padding = (max - min) * 0.1;

  return [
    Math.floor(min - padding),
    Math.ceil(max + padding)
  ];
};

// 🔥 trend detector
const getTrend = (arr, key) => {
  if (!arr || arr.length < 2) return "-";

  const prev = arr[arr.length - 2]?.[key];
  const curr = arr[arr.length - 1]?.[key];

  if (prev == null || curr == null) return "-";

  if (curr > prev) return "↑";
  if (curr < prev) return "↓";
  return "-";
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const fetchDashboard = () => {
    fetch("https://buydashboard.onrender.com/dashboard")
      .then(res => res.json())
      .then(res => {
        setData(res);
        setHistory(res.history || []);
      })
      .catch(err => setError(err));
  };

  const fetchRange = () => {
    if (!start && !end) return fetchDashboard();

    fetch(`https://buydashboard.onrender.com/history-range?start=${start}&end=${end}`)
      .then(res => res.json())
      .then(res => {
        setHistory(res.data || []);
      })
      .catch(err => setError(err));
  };

  const handleQuickRange = (days) => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const s = startDate.toISOString().slice(0, 10);
    const e = endDate.toISOString().slice(0, 10);

    setStart(s);
    setEnd(e);

    setTimeout(fetchRange, 100);
  };

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 10000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return <div style={{ padding: 20 }}>Error: เชื่อม backend ไม่ได้</div>;
  }

  if (!data || !data.today) {
    return <div style={{ padding: 20 }}>Loading...</div>;
  }

  const { today } = data;

  // 🔥 trends
  const setTrend = getTrend(history, "set");
  const foreignTrend = getTrend(history, "foreign");
  const thbTrend = getTrend(history, "thb");
  const volumeTrend = getTrend(history, "volume");

  // 🔥 smart score
  let smartScore = 0;

  if (setTrend === "↑") smartScore += 1;
  if (setTrend === "↓") smartScore -= 1;

  if (foreignTrend === "↑") smartScore += 2;
  if (foreignTrend === "↓") smartScore -= 2;

  if (thbTrend === "↓") smartScore += 1;
  if (thbTrend === "↑") smartScore -= 1;

  if (volumeTrend === "↑") smartScore += 1;
  if (volumeTrend === "↓") smartScore -= 1;

  // 🔥 BIGCAP SCORE
  let bigcapScore = 0;

  if (today.bigcap) {
    Object.values(today.bigcap).forEach(d => {
      if (d.trend === "↑") bigcapScore += 1;
      if (d.trend === "↓") bigcapScore -= 1;
    });
  }

  // 🔥 รวมเข้า Smart Score
  smartScore += bigcapScore * 0.5;

  // 🔥 smart signal
  let smartSignal = "SIDEWAY";
  if (smartScore >= 3) smartSignal = "BULL";
  if (smartScore <= -3) smartSignal = "BEAR";

  // 🔥 BigCap Signal
  let bigcapSignal = "NEUTRAL";
  if (bigcapScore >= 2) bigcapSignal = "STRONG UP";
  if (bigcapScore <= -2) bigcapSignal = "STRONG DOWN";

  // 🔥 CRITERIA SYSTEM
  const criteria = [
    { name: "SET Trend", value: setTrend, pass: setTrend === "↑" },
    { name: "Foreign Flow", value: foreignTrend, pass: foreignTrend === "↑" },
    { name: "Volume", value: volumeTrend, pass: volumeTrend === "↑" },
    { name: "THB Weak", value: thbTrend, pass: thbTrend === "↓" },
    { name: "BigCap Support", value: bigcapSignal, pass: bigcapSignal.includes("UP") }
  ];

  const passCount = criteria.filter(c => c.pass).length;

  let criteriaSignal = "WAIT";
  if (passCount >= 4) criteriaSignal = "STRONG BUY";
  if (passCount <= 2) criteriaSignal = "AVOID";

  return (
    <div style={{ padding: 24, display: "grid", gap: 24 }}>

      {/* FILTER */}
      <Card>
        <div style={{ display: "flex", gap: 10 }}>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          <button onClick={fetchRange}>โหลดข้อมูล</button>

          <select onChange={(e) => handleQuickRange(Number(e.target.value))}>
            <option>เลือกย้อนหลัง</option>
            <option value="3">Last 3 days</option>
            <option value="7">Last 7 days</option>
            <option value="10">Last 10 days</option>
          </select>
        </div>
      </Card>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 16 }}>
        <Card>SET<br /><b>{formatNumber(today.set)} {setTrend}</b></Card>

        <Card>
          THB/USD<br />
          <b style={{ color: thbTrend === "↓" ? "green" : "red" }}>
            {formatNumber(today.thb)} {thbTrend}
          </b>
        </Card>

        <Card>
          Smart Signal<br />
          <b style={{ color: smartSignal === "BULL" ? "green" : smartSignal === "BEAR" ? "red" : "gray" }}>
            {smartSignal}
          </b>
        </Card>

        <Card>
          Smart Score<br />
          <b style={{ color: smartScore >= 3 ? "green" : smartScore <= -3 ? "red" : "gray" }}>
            {smartScore}
          </b>
        </Card>

        <Card>
          Foreign<br />
          <b style={{ color: foreignTrend === "↑" ? "green" : "red" }}>
            {formatNumber(today.foreign)} {foreignTrend}
          </b>
        </Card>

        <Card>
          Volume<br />
          <b style={{ color: volumeTrend === "↑" ? "green" : "red" }}>
            {formatNumber(today.volume)} {volumeTrend}
          </b>
        </Card>

        <Card>
          BigCap<br />
          <b style={{
            color: bigcapSignal.includes("UP") ? "green" :
                   bigcapSignal.includes("DOWN") ? "red" : "gray"
          }}>
            {bigcapSignal}
          </b>
        </Card>

        <Card>
          Entry<br />
          <b style={{ color: today.entry?.includes("BUY") ? "green" : "red" }}>
            {today.entry}
          </b>
        </Card>
      </div>

      {/* BIG CAP */}
      <Card>
        <div style={{ fontWeight: "bold", marginBottom: 10 }}>
          BigCap Movement
        </div>

        <div style={{ marginBottom: 10 }}>
          Signal:
          <b style={{
            marginLeft: 6,
            color:
              bigcapSignal.includes("UP") ? "green" :
              bigcapSignal.includes("DOWN") ? "red" : "gray"
          }}>
            {bigcapSignal}
          </b>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {today.bigcap &&
            Object.entries(today.bigcap).map(([name, d]) => (
              <div key={name} style={{
                padding: 10,
                borderRadius: 10,
                minWidth: 90,
                textAlign: "center",
                background:
                  d.trend === "↑" ? "#d4edda" :
                  d.trend === "↓" ? "#f8d7da" : "#eee"
              }}>
                <b>{name}</b><br />
                {d.price}<br />
                <span style={{
                  color:
                    d.trend === "↑" ? "green" :
                    d.trend === "↓" ? "red" : "gray"
                }}>
                  {d.trend}
                </span>
              </div>
            ))}
        </div>
      </Card>

      {/* CRITERIA */}
      <Card>
        <div style={{ fontWeight: "bold", marginBottom: 10 }}>
          Trade Criteria
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          {criteria.map((c, i) => (
            <div key={i} style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "6px 10px",
              borderRadius: 8,
              background: c.pass ? "#e6f4ea" : "#fdecea"
            }}>
              <span>{c.name}</span>
              <span>{c.pass ? "✅" : "❌"} {c.value}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10 }}>
          Signal:
          <b style={{
            marginLeft: 6,
            color:
              criteriaSignal === "STRONG BUY" ? "green" :
              criteriaSignal === "AVOID" ? "red" : "gray"
          }}>
            {criteriaSignal}
          </b>
        </div>
      </Card>

      {/* CHART */}
      {["set", "score", "foreign", "volume"].map((key) => (
        <Card key={key}>
          {key.toUpperCase()} Trend
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={history}>
              <XAxis dataKey="date" />
              <YAxis domain={getDomain(history, key)} />
              <Tooltip formatter={(v) => v?.toLocaleString()} />
              <Line dataKey={key} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      ))}

    </div>
  );
}