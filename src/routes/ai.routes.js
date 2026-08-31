const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/generate', async (req, res) => {
    try {
        const { type, businessType, businessName, productName, targetCustomer, tone, extraContext } = req.body;

        let prompt = '';

        switch (type) {
            case 'store_name':
                prompt = `Generate 5 creative catchy store names for a ${businessType} business${targetCustomer ? ` targeting ${targetCustomer}` : ''}${extraContext ? `. Context: ${extraContext}` : ''}.
Return ONLY a JSON array of 5 names. Example: ["Name1","Name2","Name3","Name4","Name5"]`;
                break;

            case 'tagline':
                prompt = `Generate 5 short catchy taglines for "${businessName}", a ${businessType} store${targetCustomer ? ` for ${targetCustomer}` : ''}.
Each under 10 words, memorable and inspiring.
Return ONLY a JSON array of 5 taglines. Example: ["Tagline1","Tagline2","Tagline3","Tagline4","Tagline5"]`;
                break;

            case 'product_description':
                prompt = `Write 3 compelling product descriptions for "${productName}" sold by a ${businessType} store.
${tone ? `Tone: ${tone}.` : ''} ${extraContext ? `Details: ${extraContext}.` : ''}
Each 2-3 sentences, highlight benefits, encourage purchase.
Return ONLY a JSON array of 3 descriptions. Example: ["Desc1","Desc2","Desc3"]`;
                break;

            case 'banner_tagline':
                prompt = `Generate 5 hero banner taglines for "${businessName}", a ${businessType} store.
Bold, attention-grabbing, under 8 words each.
${extraContext ? `Theme: ${extraContext}.` : ''}
Return ONLY a JSON array of 5 taglines. Example: ["Tag1","Tag2","Tag3","Tag4","Tag5"]`;
                break;

            case 'about_us':
                prompt = `Write a professional About Us section for "${businessName}", a ${businessType} store.
${targetCustomer ? `Target customers: ${targetCustomer}.` : ''}
${extraContext ? `Additional info: ${extraContext}.` : ''}
3-4 paragraphs, warm trustworthy tone.
Return ONLY a JSON object: {"about":"full about us text here"}`;
                break;

            default:
                return res.status(400).json({ success: false, error: 'Invalid type' });
        }

        // Try models in order until one works
        const models = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-pro-latest'];
        let result = null;
        let lastError = null;
        for (const modelName of models) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                result = await model.generateContent(prompt);
                break;
            } catch (e) {
                lastError = e;
                continue;
            }
        }
        if (!result) throw lastError;
        const responseText = result.response.text().trim();

        const cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleanText);

        res.json({ success: true, data: parsed });
    } catch (error) {
        console.error('AI generation error:', error.message);
        res.status(500).json({ success: false, error: 'AI generation failed. Please try again.' });
    }
});

module.exports = router;
