const express = require("express");
const axios = require("axios");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const PORT = process.env.PORT || 10000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const CRYPTOPAY_TOKEN = process.env.CRYPTOPAY_TOKEN;
const CRYPTOPAY_WEBHOOK_SECRET = process.env.CRYPTOPAY_WEBHOOK_SECRET;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !CRYPTOPAY_TOKEN || !CRYPTOPAY_WEBHOOK_SECRET) {
  console.error("Missing env vars");
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function sendToAdmin(text) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: ADMIN_CHAT_ID,
    text,
    parse_mode: "HTML"
  });
}

app.get("/health", (req, res) => {
  res.send("ok");
});

app.get("/api/me", (req, res) => {
  const { user_id } = req.query;
  const data = loadData();

  if (!data.users[user_id]) {
    data.users[user_id] = { free_uploads: 0, referrals_paid: 0 };
    saveData(data);
  }

  res.json({
    ok: true,
    free_uploads: data.users[user_id].free_uploads
  });
});

app.post("/api/create-invoice", async (req, res) => {
  const { user_id, start_param } = req.body;

  try {
    const invoice = await axios.post(
      "https://pay.crypt.bot/api/createInvoice",
      {
        asset: "TON",
        amount: "1",
        description: "Absurd contest entry"
      },
      {
        headers: {
          "Crypto-Pay-API-Token": CRYPTOPAY_TOKEN
        }
      }
    );

    const data = loadData();

    data.invoices[invoice.data.result.invoice_id] = {
      user_id,
      paid: false,
      ref: start_param || null
    };

    saveData(data);

    res.json({
      ok: true,
      pay_url: invoice.data.result.pay_url,
      invoice_id: invoice.data.result.invoice_id
    });
  } catch (e) {
    res.json({ ok: false });
  }
});

app.get("/api/invoice-status", (req, res) => {
  const { invoice_id } = req.query;
  const data = loadData();

  if (!data.invoices[invoice_id]) {
    return res.json({ status: "not_found" });
  }

  res.json({
    status: data.invoices[invoice_id].paid ? "paid" : "pending"
  });
});

app.post("/api/submit", upload.single("image"), async (req, res) => {
  const { user_id, wallet, title, invoice_id, use_free } = req.body;
  const data = loadData();

  if (!data.users[user_id]) {
    data.users[user_id] = { free_uploads: 0, referrals_paid: 0 };
  }

  if (use_free === "1") {
    if (data.users[user_id].free_uploads <= 0) {
      return res.json({ ok: false });
    }
    data.users[user_id].free_uploads -= 1;
  } else {
    if (!invoice_id || !data.invoices[invoice_id] || !data.invoices[invoice_id].paid) {
      return res.json({ ok: false });
    }
  }

  saveData(data);

  await sendToAdmin(
    `🔥 <b>Новая работа</b>\n\n` +
    `👤 User: <code>${user_id}</code>\n` +
    `💼 Wallet: <code>${wallet}</code>\n` +
    `🖼 Название: <b>${title}</b>\n`
  );

  res.json({ ok: true });
});

app.post(`/api/cryptopay/webhook/${CRYPTOPAY_WEBHOOK_SECRET}`, (req, res) => {
  const update = req.body;

  if (update.update_type === "invoice_paid") {
    const invoice_id = update.payload.invoice_id;
    const data = loadData();

    if (data.invoices[invoice_id]) {
      data.invoices[invoice_id].paid = true;

      const user_id = data.invoices[invoice_id].user_id;
      const ref = data.invoices[invoice_id].ref;

      if (ref && ref.startsWith("ref_")) {
        const refUser = ref.replace("ref_", "");

        if (!data.users[refUser]) {
          data.users[refUser] = { free_uploads: 0, referrals_paid: 0 };
        }

        data.users[refUser].referrals_paid += 1;

        if (data.users[refUser].referrals_paid % 3 === 0) {
          data.users[refUser].free_uploads += 1;
        }
      }

      saveData(data);
    }
  }

  res.sendStatus(200);
});

app.post("/api/set-winner", async (req, res) => {
  const { wallet } = req.body;
  const data = loadData();
  data.winner = wallet;
  saveData(data);

  await sendToAdmin(`👑 Победитель недели установлен:\n<code>${wallet}</code>`);

  res.json({ ok: true });
});

app.get("/api/winner", (req, res) => {
  const data = loadData();
  res.json({ winner: data.winner });
});

app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
