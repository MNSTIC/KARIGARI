import { generateContentWithFallback } from './src/lib/gemini';
import fs from 'fs';

const imgBuffer = fs.readFileSync('C:/Users/bmsah/.gemini/antigravity/brain/9d74f860-36a1-4083-b4cd-7e565061f14d/.user_uploaded/media_1788590407000.png');
const base64Image = imgBuffer.toString('base64');

async function test() {
  const prompt = `Read the text encoded in the QR code shown in this image.
The QR code might be printed on a patch attached to a product.
If you can read the QR code, reply ONLY with the exact decoded text (which is typically a URL or an ID).
If you cannot read any QR code in the image, reply ONLY with the exact word NOT_FOUND.`;

  try {
    const result = await generateContentWithFallback(
      [
        { text: prompt },
        { inlineData: { data: base64Image, mimeType: 'image/png' } },
      ],
      {
        thinkingConfig: { thinkingBudget: 0 },
      },
      ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite']
    );
    console.log("Gemini Output:", (result as any).text);
  } catch (e) {
    console.log("Error:", e);
  }
}
test();
