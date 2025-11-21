// Endpoint for generating the main photoshoot
app.post('/api/generatePhotoshoot', verifyToken, authenticateAndCharge(1), async (req, res) => {
    const { parts } = req.body;
    const userEmail = req.userEmail;

    if (!parts || !Array.isArray(parts) || parts.length < 2) {
         await db.read();
         if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 1;
            await db.write();
         }
         return res.status(400).json({ error: 'Некорректные данные для фотосессии.' });
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview', // Upgraded to Gemini 3 Pro
            contents: { parts: parts },
            config: { 
                responseModalities: [Modality.IMAGE],
                imageConfig: { imageSize: '2K' } // Enable 2K High Resolution
            },
        });
        const generatedImagePart = response.candidates[0].content.parts.find(part => part.inlineData);
        if (!generatedImagePart || !generatedImagePart.inlineData) {
            throw new Error('Gemini не вернул изображение фотосессии.');
        }
        const generatedPhotoshootResult = { base64: generatedImagePart.inlineData.data, mimeType: generatedImagePart.inlineData.mimeType };
        const resultUrl = `data:${generatedPhotoshootResult.mimeType};base64,${generatedPhotoshootResult.base64}`;
        await db.read();
        res.json({ resultUrl, generatedPhotoshootResult, newCredits: db.data.users[userEmail].credits });
    } catch (error) {
        await db.read();
        if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 1;
            await db.write();
        }
        const userMessage = handleGeminiError(error, 'Не удалось сгенерировать фотосессию.');
        res.status(500).json({ error: userMessage });
    }
});