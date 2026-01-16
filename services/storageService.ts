
import { TournamentData, UserProfile } from "../types";

const API_KEY = "$2a$10$kXUmjFs3Oa1/CBjCP6IZLOI/McHJCHe7MwbiJhM0cbTPTgV24GPfO";
const BIN_ID_KEY = "fc25_cloud_bin_id";
const BASE_URL = "https://api.jsonbin.io/v3/b";

export interface CloudData {
  users: UserProfile[];
  tournaments: TournamentData[];
}

const defaultData: CloudData = {
  users: [],
  tournaments: []
};

// Helper to get headers
const getHeaders = (includeMasterKey = true) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (includeMasterKey) {
    headers['X-Master-Key'] = API_KEY;
  }
  return headers;
};

export const initializeCloudStorage = async (): Promise<CloudData> => {
  let binId = localStorage.getItem(BIN_ID_KEY);

  if (!binId) {
    // Create new bin if doesn't exist locally
    try {
      const response = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'X-Bin-Name': 'FC25_Manager_DB'
        },
        body: JSON.stringify(defaultData)
      });
      
      if (!response.ok) throw new Error('Failed to create bin');
      
      const data = await response.json();
      binId = data.metadata.id;
      if (binId) {
          localStorage.setItem(BIN_ID_KEY, binId);
      }
      return defaultData;
    } catch (e) {
      console.error("Cloud Init Error:", e);
      return defaultData;
    }
  } else {
    // Read existing bin
    return await loadFromCloud();
  }
};

export const loadFromCloud = async (): Promise<CloudData> => {
  const binId = localStorage.getItem(BIN_ID_KEY);
  if (!binId) return defaultData;

  try {
    const response = await fetch(`${BASE_URL}/${binId}`, {
      method: 'GET',
      headers: {
        ...getHeaders(),
        'X-Bin-Meta': 'false' // Get purely the data object
      }
    });

    if (!response.ok) {
        // If 404, maybe bin was deleted, clear local ID
        if (response.status === 404) localStorage.removeItem(BIN_ID_KEY);
        throw new Error('Failed to fetch bin');
    }

    const data = await response.json();
    return data || defaultData;
  } catch (e) {
    console.error("Cloud Load Error:", e);
    return defaultData;
  }
};

export const saveToCloud = async (data: CloudData) => {
  const binId = localStorage.getItem(BIN_ID_KEY);
  if (!binId) return;

  try {
    await fetch(`${BASE_URL}/${binId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.error("Cloud Save Error:", e);
  }
};
