const API_BASE = window.AVTODROM_API || 'http://localhost:3000/api';

export function setApiBase(url){ window.AVTODROM_API = String(url).replace(/\/$/, ''); }
export function getToken(){ return localStorage.getItem('avtodrom_token') || ''; }
export function saveAuth(data){ localStorage.setItem('avtodrom_token', data.token); localStorage.setItem('avtodrom_user', JSON.stringify(data.user)); }
export function logout(){ localStorage.removeItem('avtodrom_token'); localStorage.removeItem('avtodrom_user'); }
export function currentUser(){ try{return JSON.parse(localStorage.getItem('avtodrom_user')||'null')}catch{return null} }

export async function api(path, options={}){
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  const token = getToken();
  if(token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${window.AVTODROM_API || API_BASE}${path}`, {...options, headers});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Server xatosi');
  return data;
}

export const login = (username,password)=>api('/auth/login',{method:'POST',body:JSON.stringify({username,password})});
export const register = (fullName,username,password)=>api('/auth/register',{method:'POST',body:JSON.stringify({fullName,username,password})});
export const getSettings = ()=>api('/settings');
export const saveSettings = body=>api('/settings',{method:'PUT',body:JSON.stringify(body)});
export const activeSessions = ()=>api('/sessions/active');
export const startSession = body=>api('/sessions/start',{method:'POST',body:JSON.stringify(body)});
export const finishSession = id=>api(`/sessions/${id}/finish`,{method:'POST'});
export const dashboard = ()=>api('/dashboard');
export const dailyReport = date=>api(`/reports/daily?date=${encodeURIComponent(date)}`);
