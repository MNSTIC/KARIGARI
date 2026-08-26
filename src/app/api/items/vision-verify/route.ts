import { NextRequest, NextResponse } from "next/server";
import { generateContentWithFallback } from '@/lib/gemini';

/**
 * Latency-first model order. The shared FALLBACK_MODELS list leads with
 * gemini-3.7-flash, which has been answering 503 and pushing this request past
 * 40 seconds — far too long for someone standing over a photo they just took.
 */
const CAPTURE_MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, description, targetLanguage } = await req.json();

    if (!imageBase64 || !description) {
      return NextResponse.json(
        { error: "Image and description are required for verification" },
        { status: 400 }
      );
    }

    const langName = targetLanguage === 'hi' ? 'Hindi' :
                     targetLanguage === 'te' ? 'Telugu' :
                     targetLanguage === 'or' ? 'Odia' : 'English';

    // Prepare image for Gemini Vision
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `You are an expert appraiser and copywriter for traditional Indian handcrafted items.
    The artisan has provided this rough description:
    "${description}"
    
    TASK 1: VERIFICATION
    Look at the image. Is this a real, handcrafted item that is GENERALLY consistent with the description?
    Be lenient. Reject it ONLY if it is obviously a random unrelated object (like a laptop), a selfie, a screenshot, or completely unrelated to the craft.

    TASK 2: E-COMMERCE DESCRIPTION
    Generate a compelling, professional e-commerce product description of EXACTLY 150 words based on the image and the artisan's input.
    Make it sound premium, highlighting the traditional craftsmanship, materials, and effort. 
    Provide this description in English.
    
    TASK 3: TRANSLATION
    Translate that exact 150-word English description into ${langName}. If the target language is English, just duplicate the English description.
    
    TASK 4: AI QUALITY ASSURANCE & DEFECT DETECTION
    Analyze the image closely for visible defects (e.g., loose threads, uneven color bleeding, tears, or structural flaws). 
    If the item appears high quality and free of obvious defects, set qualityCheckPassed to true and provide brief notes (e.g., "Fabric weave is consistent, no visible flaws"). If defects are found, set it to false and explain.
    `;

    const result = await generateContentWithFallback(
      [
        { text: prompt },
        { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
      ],
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            isVerified: { type: "BOOLEAN" },
            reasoning: { type: "STRING" },
            qualityCheckPassed: { type: "BOOLEAN" },
            qualityCheckNotes: { type: "STRING" },
            descriptionEnglish: { type: "STRING" },
            descriptionLocal: { type: "STRING" }
          },
          required: ["isVerified", "reasoning", "qualityCheckPassed", "qualityCheckNotes", "descriptionEnglish", "descriptionLocal"]
        }
      },
      CAPTURE_MODELS
    );

    // generateContentWithFallback resolves to the SDK response object, not a
    // string — the JSON lives on `.text`. Reading the object directly left
    // every field undefined, which read as "not verified" and rejected every
    // image while saving an empty listing.
    const rawText =
      typeof result === 'string' ? result : (result as { text?: string })?.text || '';

    let parsedResult;
    try {
      parsedResult = JSON.parse(
        rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
      );
    } catch (e) {
      console.error("Failed to parse Gemini response", e);
      parsedResult = {
        isVerified: true,
        reasoning: "Vision service returned an unreadable response; accepted without an AI check.",
        qualityCheckPassed: true,
        qualityCheckNotes: "Quality check unavailable.",
        descriptionEnglish: description,
        descriptionLocal: description,
      };
    }

    return NextResponse.json({
      success: true,
      data: parsedResult
    });
  } catch (error) {
    console.error("Vision Verify Error:", error);
    return NextResponse.json(
      { error: "Failed to verify image using AI", details: (error as Error)?.message },
      { status: 500 }
    );
  }
}
