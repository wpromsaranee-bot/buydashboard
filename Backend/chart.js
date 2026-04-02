import { Line } from "react-chartjs-2";

const data = {
  labels: history.map(d => d.date),
  datasets: [
    {
      label: "SET",
      data: history.map(d => d.set),
    },
    {
      label: "Score",
      data: history.map(d => d.score),
    }
  ]
};

<Line data={data} />