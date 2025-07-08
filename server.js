const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
const csvParse = require('csv-parse/sync');

dotenv.config();
const app = express();
const port = 3001;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload = multer({ dest: 'uploads/' });

// --- Load custom translations from CSV ---
const WORD_CSV_PATH = path.join(__dirname, 'word-translations.csv');
let customTranslations = {};
let csvLastMtime = 0;

function loadCustomTranslations() {
  if (!fs.existsSync(WORD_CSV_PATH)) return;
  const stat = fs.statSync(WORD_CSV_PATH);
  csvLastMtime = stat.mtimeMs;

  const content = fs.readFileSync(WORD_CSV_PATH, 'utf8');
  const records = csvParse.parse(content, { columns: true, trim: true, skip_empty_lines: true });
  customTranslations = {}; // { "milk": { si: "...", hr: "...", ... }, ... }
  records.forEach(row => {
    const key = row.english.trim().toLowerCase();
    customTranslations[key] = {
      si: row.si || "",
      hr: row.hr || "",
      it: row.it || "",
      de: row.de || "",
      fr: row.fr || "",
      es: row.es || "",
      pt: row.pt || ""
    };
  });
}
loadCustomTranslations();

function isCustomCsvStale() {
  if (!fs.existsSync(WORD_CSV_PATH)) return false;
  const stat = fs.statSync(WORD_CSV_PATH);
  return stat.mtimeMs !== csvLastMtime;
}

// --- Express Setup ---
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting (10 requests per minute per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests, please try again in a minute." }
});
app.use('/generate', limiter);
app.use('/translate', limiter);

// Serve the HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// --- Generate Alt Text (with OpenAI Vision) ---
app.post('/generate', upload.single('image'), async (req, res) => {
  try {
    const { name, brand, weight, flavor } = req.body;
    const requiredFields = [name, weight];
    if (requiredFields.some(f => !f || f.trim() === "")) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Required fields are missing." });
    }

    const imageData = fs.readFileSync(req.file.path, { encoding: 'base64' });
    const imageMimeType = req.file.mimetype;
    const imageDataUrl = `data:${imageMimeType};base64,${imageData}`;

    // Compose improved prompt (as discussed)
    let prompt = `
You are an SEO assistant. Generate a single, concise, SEO-optimized alt text for an e-commerce product image, using the provided product data and image.

Write the alt text as a natural, easily readable sentence, not just a list. Start with the brand and product name, then naturally include the pack size (weight/quantity) and flavor if present, followed by a brief visual description of the packaging with functional or visible features only—such as a resealable pouch (if visible), or any badges or icons for "lactose free," "gluten free," or similar attributes (sometimes seen in the product name itself).

Do not use generic design adjectives like "sleek," "modern," "minimalistic," or similar. Do not use or reference any visible text or claims except for functional badges as described above. Do not invent features that are not visible or provided.

The alt text must be between 115 and 130 characters in English, and output only the alt text, nothing else.

Here is the product data:
Brand: ${brand || "N/A"}
Product Name: ${name}
Pack Size: ${weight}
Flavor: ${flavor || "N/A"}
    `.trim();

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 200,
      temperature: 0.8,
      messages: [
        { role: "system", content: "You are a helpful assistant for SEO and e-commerce." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } }
          ]
        }
      ]
    });

    fs.unlinkSync(req.file.path);

    let alt = response.choices[0]?.message?.content?.trim() || "";
    alt = alt.replace(/^["']|["']$/g, '').replace(/^Alt: /i, '').trim();

    res.json({ alt, isCustomCsvStale: isCustomCsvStale() });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// --- Translation Endpoint ---
app.post('/translate', async (req, res) => {
  try {
    let { text } = req.body;
    if (!text) return res.status(400).json({ error: "No alt text provided." });
    text = text.trim();
    if (!text) return res.status(400).json({ error: "No alt text provided." });

    // Get custom mapping (case-insensitive, whole words/phrases only)
    const mapping = customTranslations;

    // List of target languages in order
    const langs = [
      { code: 'si', name: 'SI', lang: 'Slovenian' },
      { code: 'hr', name: 'HR', lang: 'Croatian' },
      { code: 'it', name: 'IT', lang: 'Italian' },
      { code: 'de', name: 'DE', lang: 'German' },
      { code: 'fr', name: 'FR', lang: 'French' },
      { code: 'es', name: 'ES', lang: 'Spanish' },
      { code: 'pt', name: 'PT', lang: 'Portuguese' },
    ];

    // For each language, build a list of custom mappings found in the input
    // and supply these in the prompt to force OpenAI to use them where possible.
    async function translateOne(target) {
      // Find all keys present in the text (case-insensitive, whole word/phrase)
      const matches = [];
      for (const key in mapping) {
        // Escape regex for phrase/word
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Word/phrase boundary (start/end, or whitespace/punct)
        const regex = new RegExp(`\\b${esc}\\b`, 'i');
        if (regex.test(text)) {
          matches.push({ word: key, translation: mapping[key][target] });
        }
      }

      let translationInstructions = "";
      if (matches.length > 0) {
        translationInstructions = `Always use the following translations for these words or phrases if they appear:\n` +
          matches.map(m => `"${m.word}" = "${m.translation}"`).join('\n') +
          `\nAdjust grammar, tense, or plural as needed for fluency in ${langs.find(l => l.code === target).lang}.`;
      }

      // Ask GPT to translate, keeping your mappings fixed where found
      const prompt = `
Translate the following alt text to ${langs.find(l => l.code === target).lang}. ${translationInstructions}

If a word or phrase is not in the list, translate it naturally. Keep the text easily readable and natural. Try to keep the translation between 115 and 130 characters if possible, but do not sacrifice naturalness.

Alt text to translate:
"${text}"
`.trim();

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 250,
        temperature: 0.3,
        messages: [
          { role: "system", content: "You are a helpful assistant for e-commerce and translation." },
          { role: "user", content: prompt }
        ]
      });
      let output = completion.choices[0].message.content.trim();
      // Remove wrapping quotes if present
      output = output.replace(/^["']|["']$/g, '');
      return output;
    }

    // Translate in parallel for all languages
    const translations = {};
    await Promise.all(langs.map(async l => {
      translations[l.code] = await translateOne(l.code);
    }));

    res.json({ translations, isCustomCsvStale: isCustomCsvStale() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Translation error." });
  }
});

// Endpoint to check if custom csv mapping is stale
app.get('/csv-status', (req, res) => {
  res.json({ isCustomCsvStale: isCustomCsvStale() });
});

app.listen(port, () => {
  console.log(`SEO Alt Tag app listening at http://localhost:${port}`);
});
