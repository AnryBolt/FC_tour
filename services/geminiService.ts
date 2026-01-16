
import { GoogleGenAI } from "@google/genai";
import { PlayerStats, Match } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeTournament = async (
  standings: PlayerStats[],
  recentMatches: Match[],
  players: Map<number, string>
) => {
  try {
    const standingsText = standings.map((s, i) => 
      `${i + 1}. ${s.name} (И:${s.played} В:${s.won} Н:${s.drawn} П:${s.lost} Очки:${s.points})`
    ).join('\n');

    const matchesText = recentMatches.slice(-5).map(m => {
       const home = players.get(m.homeId) || 'Неизвестно';
       const away = players.get(m.awayId) || 'Неизвестно';
       return `${home} ${m.homeScore} - ${m.awayScore} ${away}`;
    }).join('\n');

    const prompt = `
      Ты страстный футбольный комментатор. Проанализируй текущее состояние турнира.
      
      Вот текущая таблица:
      ${standingsText}

      Вот последние результаты матчей:
      ${matchesText}

      Дай короткий, захватывающий комментарий на русском языке о том, кто лидирует, кто отстает и были ли неожиданные результаты. Не более 100 слов. Используй эмодзи.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Не удалось сгенерировать анализ в данный момент. Попробуйте позже.";
  }
};
