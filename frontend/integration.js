import { api, saveAuth, logout, getSettings, saveSettings, activeSessions, startSession, finishSession, dashboard, dailyReport } from './api.js';

export const Avtodrom = {
  login: async (username, password) => { const data = await api('/auth/login', { method:'POST', body:JSON.stringify({username,password}) }); saveAuth(data); return data; },
  register: async (fullName, username, password) => { const data = await api('/auth/register', { method:'POST', body:JSON.stringify({fullName,username,password}) }); saveAuth(data); return data; },
  logout,
  settings: getSettings,
  updateSettings: saveSettings,
  active: activeSessions,
  start: startSession,
  finish: finishSession,
  dashboard,
  report: dailyReport
};

window.Avtodrom = Avtodrom;
