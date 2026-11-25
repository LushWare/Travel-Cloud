import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { generateStructured, isAIConfigured } from '../ai/aiClient.js';
import { buildHotelSuggestionPrompt, hotelSuggestionResponseSchema } from '../ai/prompts/hotelSuggestion.v1.js';

export const suggestHotels = asyncHandler(async (req, res) => {
  const { destination, location, checkIn, checkOut, guests, budget, preferences } = req.body;

  if (!destination) throw new AppError('destination is required', 400);

  if (!isAIConfigured()) {
    return res.json({ success: true, data: { hotels: [], message: 'AI hotel suggestions not configured' } });
  }

  const prompt = buildHotelSuggestionPrompt({ destination, location, checkIn, checkOut, guests, budget, preferences });
  const { hotels } = await generateStructured({ prompt, schema: hotelSuggestionResponseSchema });

  res.json({ success: true, data: { hotels: hotels || [], destination } });
});
