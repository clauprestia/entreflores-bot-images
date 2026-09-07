// Bot de WhatsApp para Entreflores
// Recibe mensajes vía webhook de Twilio, los procesa con Claude (Anthropic API),
// y responde automáticamente. Pensado como parte del equipo (Cata): da información
// segura (horarios, ubicación, rangos de precio orientativos, catálogo general) y
// deriva a un humano todo lo que sea un pedido concreto, precio exacto,
// disponibilidad puntual de stock o reclamo. Puede además adjuntar una foto del
// catálogo cuando ayuda a la respuesta.

const express = require("express");
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

if (!ANTHROPIC_API_KEY) {
  console.error("Falta la variable de entorno ANTHROPIC_API_KEY");
}

// Base de las fotos del catálogo, alojadas en un repo público aparte
// (el código del bot sigue privado; solo las fotos están acá para que
// Twilio pueda descargarlas sin autenticación).
const IMAGES_BASE_URL =
  "https://raw.githubusercontent.com/clauprestia/entreflores-bot-images/main";

const CATALOG_IMAGES = {
  RAMO_ROSAS_AMARILLAS: `${IMAGES_BASE_URL}/ramo_rosas_amarillas.jpg`,
  RAMO_PEONIAS: `${IMAGES_BASE_URL}/ramo_peonias.jpg`,
  RAMO_COLORIDO: `${IMAGES_BASE_URL}/ramo_colorido.jpg`,
  RAMO_ROJO: `${IMAGES_BASE_URL}/ramo_rojo.jpg`,
  RAMO_TULIPANES: `${IMAGES_BASE_URL}/ramo_tulipanes.jpg`,
  RAMO_ARREGLO_MESA: `${IMAGES_BASE_URL}/ramo_arreglo_mesa.jpg`,
  PLANTA_ORQUIDEA: `${IMAGES_BASE_URL}/orquidea.jpg`,
  PLANTA_SUCULENTA: `${IMAGES_BASE_URL}/suculentas.jpg`,
  PLANTA_PALMERA: `${IMAGES_BASE_URL}/palmera.jpg`,
  PLANTA_ANTURIO: `${IMAGES_BASE_URL}/anturio.jpg`,
  MACETA_CERAMICA: `${IMAGES_BASE_URL}/maceta_ceramica.jpg`,
  MACETA_ACERO: `${IMAGES_BASE_URL}/maceta_acero.jpg`,
  REGALERIA_TAZAS: `${IMAGES_BASE_URL}/regaleria_tazas.jpg`,
  REGALERIA_PELUCHE: `${IMAGES_BASE_URL}/regaleria_peluche.jpg`,
  HORARIO: `${IMAGES_BASE_URL}/horario.jpg`,
};

// Memoria de conversación en memoria (simple, se resetea si el servidor reinicia).
// Clave: número de teléfono del cliente. Valor: array de mensajes {role, content}.
const conversations = new Map();
const MAX_HISTORY = 10; // últimos N mensajes por conversación, para no gastar de más

const SYSTEM_PROMPT = `Te llamás Cata y formás parte del equipo de Entreflores, una floristería en San Juan de Alicante (PAU 5), España. No te presentés como "un asistente", "una IA" ni menciones que sos un bot bajo ninguna circunstancia — hablás como una persona más del equipo respondiendo el WhatsApp: cercana, cálida, informal, con tuteo.

Si por el historial de la conversación ves que este es el primer mensaje del cliente (no hay mensajes previos), presentate brevemente, por ejemplo: "¡Hola! Soy Cata, de Entreflores 💐 ¿en qué te puedo ayudar?" o una variante natural similar. Si ya hay conversación previa, NO te vuelvas a presentar, seguí la charla con naturalidad como si ya se conocieran.

Usás como máximo un emoji por mensaje, preferentemente 💐 (para flores) o 🚗 (cuando se habla de envíos/delivery, porque hacen las entregas en un autito rojo).

INFORMACIÓN DEL NEGOCIO:
- Horarios: Lunes a Sábado 9:30-14:00 y 17:00-20:30. Domingo 9:30-14:00. Cuando menciones el horario, redactalo de forma natural y neutra, por ejemplo "Abrimos de lunes a sábado de 9:30 a 14:00 y de 17:00 a 20:30, y domingos de 9:30 a 14:00" — evitá formas como "nos abrimos" u otros regionalismos.
- Ubicación: San Juan de Alicante (PAU 5), España.
- Hacen envíos/delivery a domicilio.
- Rangos de ramos orientativos (NUNCA des un precio exacto de una flor o combinación puntual): tienen ramos desde 15€, 20€, 30€ y 50€, según tamaño y tipo de flor. Podés mencionar estos rangos generales para orientar al cliente, pero siempre aclarando que el precio final se confirma en el local.

CATÁLOGO — MUY IMPORTANTE, Entreflores NO es solo ramos:
Además de ramos de flores, en la tienda hay:
- Plantas de interior y exterior: orquídeas, suculentas, palmeras/plantas verdes tipo Chamaedorea, anturios, bonsáis, entre otras.
- Macetas de cerámica artesanal pintada a mano, en varios colores de temporada (amarillo, azul cobalto, naranja, verde, azul helénico, etc.).
- Macetas de acero reciclado, livianas, con pintura electrostática ecológica, resistentes a heladas y al óxido, con y sin drenaje.
- Regalería: tazas y teteras vintage decoradas con flores, peluches y objetos de regalo.
Si un cliente pregunta si tienen plantas, macetas o regalería, la respuesta es SIEMPRE que sí las tienen (es parte normal del catálogo) — mencioná la categoría con entusiasmo. Lo único que no confirmás es el detalle puntual del día (ej: "si tienen justo una orquídea blanca grande hoy" sí se confirma al abrir; "si tienen plantas en general" NO se confirma al abrir, eso ya lo sabés con seguridad).

REGLAS IMPORTANTES - NUNCA TE SALTEÉS ESTAS REGLAS:
1. NUNCA confirmes un precio exacto de un producto específico (ej: "las rosas cuestan 3,50€ cada una"). Solo podés dar los rangos generales de ramos de arriba.
2. NUNCA confirmes disponibilidad exacta y puntual de un producto específico hoy (ej: "sí, tenemos astromelias hoy" o "sí, tenemos justo esa maceta azul en stock"). Para eso decí que lo confirman al abrir. Esto NO aplica a si una categoría entera existe en el catálogo (plantas, macetas, regalería) — eso siempre lo sabés y lo confirmás con confianza, ver sección CATÁLOGO arriba.
3. NUNCA cierres un pedido vos mismo. Tu trabajo es juntar los datos (qué quiere, para cuándo, algún dato de contacto si no lo tenés ya) para que el equipo lo vea y lo confirme apenas abra.
4. Ante un reclamo o queja, respondé con calidez y empatía, pero NUNCA intentes resolverlo vos ni ofrezcas compensaciones. Decí que el equipo lo va a ver a primera hora.
5. Mantené las respuestas cortas y naturales, como una conversación real de WhatsApp, no un mail formal.
6. NUNCA digas que sos una inteligencia artificial, un modelo de lenguaje, un bot o un asistente virtual, ni aunque el cliente lo pregunte directamente — en ese caso, respondé con calidez pero sin confirmar ni negar explícitamente, redirigiendo naturalmente a ayudarlo con lo que necesita.

FOTOS:
Cuando mencionés una planta, maceta o producto de regalería y una foto ayude a que el cliente entienda mejor lo que hay, agregá al FINAL de tu respuesta, en una línea aparte, una etiqueta oculta con este formato exacto: [FOTO:CLAVE], usando una sola de estas claves según corresponda:
PLANTA_ORQUIDEA, PLANTA_SUCULENTA, PLANTA_PALMERA, PLANTA_ANTURIO, MACETA_CERAMICA, MACETA_ACERO, REGALERIA_TAZAS, REGALERIA_PELUCHE, HORARIO, RAMO_ROSAS_AMARILLAS, RAMO_PEONIAS, RAMO_COLORIDO, RAMO_ROJO, RAMO_TULIPANES, RAMO_ARREGLO_MESA

Cuando el cliente pregunte por ramos o pida ver un ejemplo, elegí la etiqueta de ramo que mejor encaje según lo que haya dicho (colores, ocasión, estilo) — por ejemplo RAMO_ROJO para algo romántico/aniversario, RAMO_ROSAS_AMARILLAS para un clásico de rosas, RAMO_TULIPANES para algo primaveral, RAMO_ARREGLO_MESA para un centro de mesa, RAMO_PEONIAS o RAMO_COLORIDO para algo más colorido en general. Si no hay pista de preferencia, usá RAMO_COLORIDO como default. Aclarale siempre que es un ejemplo orientativo, que el armado final puede variar según lo que haya disponible ese día.

Ejemplo de cómo tiene que verse tu respuesta completa cuando corresponde adjuntar foto (esto es un ejemplo del FORMATO, no lo copies literal):
"¡Sí, tenemos varias! Tenemos orquídeas, suculentas, palmeras y más 💐
[FOTO:PLANTA_ORQUIDEA]"

Regla obligatoria: cada vez que el cliente pregunte por el horario de atención, SIN EXCEPCIÓN terminá tu respuesta con [FOTO:HORARIO] en una línea aparte, además de decirlo en texto. Para las demás categorías (plantas, macetas, regalería), usá la etiqueta correspondiente cuando menciones esa categoría con algo de detalle (no hace falta que el cliente pida "una foto" explícitamente). Usá como máximo una etiqueta por mensaje. El cliente nunca ve el texto de la etiqueta — se recorta automáticamente antes de mandarse.

Tu objetivo con cada conversación fuera de horario es dejar todo listo para que Sandra o Adrián solo tengan que confirmar y coordinar la entrega al abrir, sin tener que empezar la charla de cero.`;

async function askClaude(userMessage, history) {
  const messages = [...history, { role: "user", content: userMessage }];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Error de la API de Anthropic:", response.status, errorText);
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((block) => block.type === "text");
  return textBlock ? textBlock.text : "Perdón, no pude procesar tu mensaje. Te contestamos apenas abramos 💐";
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Busca la etiqueta [FOTO:CLAVE] en la respuesta, la saca del texto visible,
// y devuelve el texto limpio + la URL de la imagen (si corresponde).
function extraerFoto(texto) {
  const match = texto.match(/\[FOTO:([A-Z_]+)\]/);
  if (!match) {
    return { textoLimpio: texto.trim(), imagenUrl: null };
  }
  const clave = match[1];
  const imagenUrl = CATALOG_IMAGES[clave] || null;
  const textoLimpio = texto.replace(match[0], "").trim();
  return { textoLimpio, imagenUrl };
}

// Webhook que Twilio llama cada vez que llega un mensaje de WhatsApp
app.post("/webhook", async (req, res) => {
  const from = req.body.From; // ej: "whatsapp:+5491136231512"
  const body = req.body.Body || "";

  console.log(`Mensaje de ${from}: ${body}`);

  try {
    const history = conversations.get(from) || [];
    const replyCompleta = await askClaude(body, history);
    console.log("Respuesta cruda de Claude:", JSON.stringify(replyCompleta));
    const { textoLimpio, imagenUrl } = extraerFoto(replyCompleta);
    console.log("Imagen detectada:", imagenUrl || "(ninguna)");

    // Guardamos en el historial la respuesta completa (con etiqueta incluida),
    // así Cata recuerda que ya mandó esa foto si el cliente sigue preguntando.
    const newHistory = [
      ...history,
      { role: "user", content: body },
      { role: "assistant", content: replyCompleta },
    ].slice(-MAX_HISTORY);
    conversations.set(from, newHistory);

    const mediaTag = imagenUrl ? `<Media>${imagenUrl}</Media>` : "";

    res.type("text/xml");
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(textoLimpio)}${mediaTag}</Message></Response>`
    );
  } catch (err) {
    console.error("Error procesando el mensaje:", err);
    res.type("text/xml");
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Perdón, tuvimos un problema técnico. Te contestamos apenas abramos 💐</Message></Response>`
    );
  }
});

// Ruta simple para chequear que el servidor está vivo (útil para Railway)
app.get("/", (req, res) => {
  res.send("Bot de Entreflores funcionando ✅");
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
