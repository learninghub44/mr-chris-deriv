const express = require('express');

const router = express.Router();

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT =
    'You are the Mr Chris market analysis assistant. You help traders think through synthetic-indices ' +
    '(volatility indices, jump indices, boom/crash) setups on Deriv. Be concise, structured, and explicit ' +
    'about risk — never claim certainty about future price direction. When given market context (symbol, ' +
    'recent ticks, trend notes) produce a short read: bias, key levels/observations, and risk notes. ' +
    'Always include a one-line reminder that this is not financial advice.';

router.post('/analyze', async (req, res, next) => {
    try {
        const prompt = String(req.body?.prompt || '').trim();
        if (!prompt) {
            res.status(400).json({ error: 'prompt is required' });
            return;
        }
        if (prompt.length > 4000) {
            res.status(400).json({ error: 'prompt is too long' });
            return;
        }

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            res.status(503).json({ error: 'GROQ_API_KEY is not configured on the backend' });
            return;
        }

        const response = await fetch(GROQ_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: process.env.GROQ_MODEL || DEFAULT_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 700,
            }),
        });

        const json = await response.json();
        if (!response.ok) {
            res.status(response.status).json({
                error: json?.error?.message || 'Groq analysis request failed',
            });
            return;
        }

        const text = json?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) {
            res.status(502).json({ error: 'Groq did not return an analysis' });
            return;
        }

        res.json({ analysis: text.trim() });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
