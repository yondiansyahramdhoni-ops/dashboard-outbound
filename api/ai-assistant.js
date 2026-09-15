// api/ai-assistant.js
// Serverless function (Vercel) — jembatan aman antara dashboard dan Google Gemini API (GRATIS).
// API key TIDAK pernah dikirim ke browser; disimpan sebagai Environment Variable di
// pengaturan project Vercel bernama GEMINI_API_KEY.

const MODEL = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 1024;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `Kamu adalah Asisten AI operasional untuk Dashboard Outbound Shopee Express Bandung DC.
Peranmu: menganalisa data status Gate, Report Realisasi, Docking OB, dan Realisasi Live yang diberikan,
lalu memberi jawaban yang PROFESIONAL, LUGAS, dan BERBASIS DATA — bukan basa-basi.

Aturan menjawab:
- Selalu jawab dalam Bahasa Indonesia yang profesional, sopan, dan ringkas (maksimal sekitar 180 kata kecuali diminta lebih detail).
- Dasarkan SELURUH analisa dan angka HANYA pada data snapshot yang diberikan di bawah. Jangan mengarang angka atau nama destinasi/gate yang tidak ada di data.
- Kalau data yang dibutuhkan untuk menjawab tidak tersedia di snapshot, katakan dengan jujur ("data ini belum tersedia di dashboard saat ini") — jangan menebak.
- Kalau pertanyaan meminta rekomendasi atau keputusan, beri rekomendasi yang MASUK AKAL dan actionable (langkah konkret), dengan alasan singkat yang mengacu ke angka/data terkait.
- Gunakan format singkat: boleh pakai poin-poin kalau menjelaskan beberapa hal sekaligus, tapi jangan berlebihan.
- Jangan mengulang seluruh data mentah — ambil insight yang relevan dengan pertanyaan saja.
- Kamu bicara sebagai bagian dari tim operasional, bukan chatbot umum — gunakan istilah yang sudah dipakai di dashboard (Gate, STD, Golden Hour, Destinasi, Loading, Occupancy, dll).`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'GEMINI_API_KEY belum diatur di Environment Variables Vercel. Buat key gratis di aistudio.google.com/apikey, tambahkan di Project Settings → Environment Variables, lalu redeploy.'
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const messages = Array.isArray(body && body.messages) ? body.messages : [];
  const context = (body && body.context) ? String(body.context) : '(tidak ada data snapshot)';

  if (!messages.length) {
    res.status(400).json({ error: 'Pertanyaan kosong.' });
    return;
  }

  const geminiContents = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const systemWithData = `${SYSTEM_PROMPT}\n\n=== DATA SNAPSHOT DASHBOARD SAAT INI (JSON) ===\n${context}`;

  try {
    const apiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemWithData }] },
        contents: geminiContents,
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS }
      })
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      const message = (data && data.error && data.error.message) ? data.error.message : ('Gemini API error (HTTP ' + apiRes.status + ')');
      res.status(apiRes.status).json({ error: message });
      return;
    }

    const candidate = (data.candidates || [])[0];
    const finishReason = candidate && candidate.finishReason;
    let reply = candidate && candidate.content && Array.isArray(candidate.content.parts)
      ? candidate.content.parts.map(p => p.text || '').join('\n').trim()
      : '';

    if (!reply && finishReason === 'SAFETY') {
      reply = 'Maaf, pertanyaan ini tidak bisa dijawab karena tersaring oleh filter keamanan Gemini. Coba ubah pertanyaannya.';
    }

    res.status(200).json({ reply: reply || 'Maaf, asisten tidak menghasilkan jawaban. Coba ulangi pertanyaan.' });
  } catch (e) {
    console.error('ai-assistant proxy error', e);
    res.status(500).json({ error: 'Gagal menghubungi Gemini API dari server: ' + (e && e.message ? e.message : String(e)) });
  }
};
