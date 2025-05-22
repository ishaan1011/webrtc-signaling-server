// tts.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
const API_KEY  = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.TTS_VOICE_ID;

if (!API_KEY || !VOICE_ID) {
  throw new Error('ELEVENLABS_API_KEY or TTS_VOICE_ID not set in .env');
}

/**
 * Send text to ElevenLabs streaming TTS and return raw audio bytes.
 * @param {string} text 
 * @returns {Promise<Buffer>}
 */
export async function generateAudio(text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`;
  const body = {
    text,
    model_id: "eleven_flash_v2_5",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.7
    }
  };
  const resp = await axios.post(url, body, {
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    responseType: 'arraybuffer',
    timeout: 15000
  });
  return resp;
}