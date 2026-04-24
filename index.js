const functions = require("firebase-functions");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// ⚙️ CONFIGURATION — Remplace par tes vraies valeurs MTN MoMo
// ============================================================
const MTN_CONFIG = {
  userId: "f131bb1d-1b1a-40fa-9e84-78d3c84b1967",         // Ton User ID MTN MoMo
  apiKey: "d541a73e122c488db0d6765a396acc0b",         // Ton API Key MTN MoMo
  subscriptionKey: "0b1707c4eed24c6689b0c91bc91badde", // Ta Subscription Key
  environment: "sandbox",            // Change en "production" quand tu es prêt
  callbackUrl: "https://renaprov.com/callback", // Ton vrai URL de callback
};

const BASE_URL = MTN_CONFIG.environment === "sandbox"
  ? "https://sandbox.momodeveloper.mtn.com"
  : "https://proxy.momoapi.mtn.com";

// ============================================================
// 🔑 ÉTAPE 1 — Obtenir un token d'accès MTN
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
// 💳 FONCTION 1 — Demander un paiement MTN MoMo
// ============================================================
exports.requestMtnPayment = functions.https.onRequest(async (req, res) => {
  // Autoriser les appels depuis ton site web
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const { phone, amount, name } = req.body;

  // Validation des données reçues
  if (!phone || !amount || !name) {
    res.status(400).json({ error: "Données manquantes : phone, amount, name requis" });
    return;
  }

  if (!/^\d{9}$/.test(phone)) {
    res.status(400).json({ error: "Numéro de téléphone invalide (9 chiffres sans indicatif)" });
    return;
  }

  try {
    const token = await getMtnToken();
    const referenceId = uuidv4(); // ID unique pour cette transaction

    await axios.post(
      `${BASE_URL}/collection/v1_0/requesttopay`,
      {
        amount: String(amount),
        currency: "XAF",
        externalId: referenceId,
        payer: {
          partyIdType: "MSISDN",
          partyId: `237${phone}`, // Ajoute l'indicatif Cameroun
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

    // Retourne l'ID de référence au site pour vérification ultérieure
    res.status(200).json({
      success: true,
      referenceId: referenceId,
      message: "Demande de paiement envoyée. Le client doit confirmer sur son téléphone.",
    });

  } catch (error) {
    console.error("Erreur MTN MoMo requestToPay:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la demande de paiement MTN MoMo",
    });
  }
});

// ============================================================
// ✅ FONCTION 2 — Vérifier le statut d'un paiement
// ============================================================
exports.checkMtnPayment = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const { referenceId } = req.body;

  if (!referenceId) {
    res.status(400).json({ error: "referenceId manquant" });
    return;
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
    // Statuts possibles : PENDING, SUCCESSFUL, FAILED, REJECTED

    res.status(200).json({
      success: true,
      status: status,
      data: response.data,
    });

  } catch (error) {
    console.error("Erreur MTN MoMo checkPayment:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la vérification du paiement",
    });
  }
});