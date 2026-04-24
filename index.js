const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

// Autoriser les appels depuis ton site web
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).send("");
  next();
});

// ============================================================
// ⚙️ CONFIGURATION — Lire les variables d'environnement Render
// ============================================================
const MTN_CONFIG = {
  userId: process.env.MTN_USER_ID,
  apiKey: process.env.MTN_API_KEY,
  subscriptionKey: process.env.MTN_SUBSCRIPTION_KEY,
  environment: process.env.MTN_ENVIRONMENT || "mtncameroon",
  callbackUrl: process.env.MTN_CALLBACK_URL,
};

const BASE_URL = "https://proxy.momoapi.mtn.com";

// ============================================================
// 🔑 Obtenir un token d'accès MTN
// ============================================================
async function getMtnToken() {
  const credentials = Buffer.from(
    `${MTN_CONFIG.userId}:${MTN_CONFIG.apiKey}`
  ).toString("base64");

  const response = await axios.post(
    `${BASE_URL}/collection/token/`,
    {},
    {
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Ocp-Apim-Subscription-Key": MTN_CONFIG.subscriptionKey,
      },
    }
  );
  return response.data.access_token;
}

// ============================================================
// 💳 ROUTE 1 — Demander un paiement MTN MoMo
// POST /request-payment
// ============================================================
app.post("/request-payment", async (req, res) => {
  const { phone, amount, name } = req.body;

  if (!phone || !amount || !name) {
    return res.status(400).json({
      error: "Données manquantes : phone, amount, name requis",
    });
  }

  if (!/^\d{9}$/.test(phone)) {
    return res.status(400).json({
      error: "Numéro invalide — entre 9 chiffres sans indicatif (ex: 672996717)",
    });
  }

  try {
    const token = await getMtnToken();
    const referenceId = uuidv4();

    await axios.post(
      `${BASE_URL}/collection/v1_0/requesttopay`,
      {
        amount: String(amount),
        currency: "XAF",
        externalId: referenceId,
        payer: {
          partyIdType: "MSISDN",
          partyId: `237${phone}`,
        },
        payerMessage: `Souscription IPO RENAPROV - ${name}`,
        payeeNote: `Paiement de ${name} pour IPO RENAPROV`,
      },
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": MTN_CONFIG.environment,
          "Ocp-Apim-Subscription-Key": MTN_CONFIG.subscriptionKey,
          "X-Callback-Url": MTN_CONFIG.callbackUrl,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      success: true,
      referenceId: referenceId,
      message: "Demande envoyée. Le client doit confirmer sur son téléphone.",
    });

  } catch (error) {
    console.error("Erreur requestToPay:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la demande de paiement MTN MoMo",
    });
  }
});

// ============================================================
// ✅ ROUTE 2 — Vérifier le statut d'un paiement
// POST /check-payment
// ============================================================
app.post("/check-payment", async (req, res) => {
  const { referenceId } = req.body;

  if (!referenceId) {
    return res.status(400).json({ error: "referenceId manquant" });
  }

  try {
    const token = await getMtnToken();

    const response = await axios.get(
      `${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-Target-Environment": MTN_CONFIG.environment,
          "Ocp-Apim-Subscription-Key": MTN_CONFIG.subscriptionKey,
        },
      }
    );

    const status = response.data.status;
    // Statuts MTN : PENDING, SUCCESSFUL, FAILED, REJECTED

    res.status(200).json({
      success: true,
      status: status,
      data: response.data,
    });

  } catch (error) {
    console.error("Erreur checkPayment:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la vérification du paiement",
    });
  }
});

// ============================================================
// 📩 ROUTE 3 — Recevoir les notifications MTN (Callback)
// POST /callback
// ============================================================
app.post("/callback", (req, res) => {
  console.log("📩 Callback MTN reçu:", JSON.stringify(req.body));
  res.status(200).send("OK");
});

// ============================================================
// 🏠 ROUTE TEST — Vérifier que le serveur fonctionne
// GET /
// ============================================================
app.get("/", (req, res) => {
  res.status(200).json({
    status: "✅ Serveur RENAPROV MTN MoMo opérationnel",
    routes: [
      "POST /request-payment",
      "POST /check-payment",
      "POST /callback",
    ],
  });
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});