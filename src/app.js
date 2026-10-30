import "dotenv/config";
import express from "express";
import cors from "cors";


const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "50kb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", aiMode: process.env.AI_MODE || "mock" });
});


const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));