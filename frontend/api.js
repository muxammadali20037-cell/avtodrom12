const API_BASE=window.AVTODROM_API||`${window.location.origin}/api`;
const cache=new Map();
const CACHE_MS=5000;
export function setApiBase(url){window.AVTODROM_API=String(url).replace(/\/$/,'')}
export function getToken(){return localStorage.getItem('avtodrom_token')||''}
export function saveAuth(data){localStorage.setItem('avtodrom_token',data.token);localStorage.setItem('avtodrom_user',JSON.stringify(data.user));cache.clear()}
export function logout(){localStorage.removeItem('avtodrom_token');localStorage.removeItem('avtodrom_user');cache.clear()}
export function currentUser(){try{return JSON.parse(localStorage.getItem('avtodrom_user')||'null')}catch{return null}}
export async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};const token=getToken();if(token)headers.Authorization=`Bearer ${token}`;const res=await fetch(`${window.AVTODROM_API||API_BASE}${path}`,{...options,headers});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Server xatosi');return data}
async function cached(path){const hit=cache.get(path);if(hit&&Date.now()-hit.time<CACHE_MS)return hit.data;const data=await api(path);cache.set(path,{time:Date.now(),data});return data}
function invalidate(prefix){for(const key of cache.keys())if(key.startsWith(prefix))cache.delete(key)}
export const login=(username,password)=>api('/auth/login',{method:'POST',body:JSON.stringify({username,password})});
export const register=(fullName,username,password)=>api('/auth/register',{method:'POST',body:JSON.stringify({fullName,username,password})});
export const getSettings=()=>cached('/settings');
export const saveSettings=async body=>{const d=await api('/settings',{method:'PUT',body:JSON.stringify(body)});invalidate('/settings');return d};
export const activeSessions=()=>api('/sessions/active');
export const startSession=async body=>{const d=await api('/sessions/start',{method:'POST',body:JSON.stringify(body)});invalidate('/dashboard');invalidate('/schools');invalidate('/groups');invalidate('/students');return d};
export const finishSession=async(id,body)=>{const d=await api(`/sessions/${id}/finish`,{method:'POST',body:JSON.stringify(body)});invalidate('/dashboard');return d};
export const dashboard=()=>cached('/dashboard');
export const dailyReport=date=>api(`/reports/daily?date=${encodeURIComponent(date)}`);
export const schools=()=>cached('/schools');
export const createSchool=async body=>{const d=await api('/schools',{method:'POST',body:JSON.stringify(body)});invalidate('/schools');return d};
export const groups=schoolId=>cached(`/groups${schoolId?`?schoolId=${encodeURIComponent(schoolId)}`:''}`);
export const createGroup=async body=>{const d=await api('/groups',{method:'POST',body:JSON.stringify(body)});invalidate('/groups');invalidate('/schools');return d};
export const students=(schoolId,groupId)=>{const p=new URLSearchParams();if(schoolId)p.set('schoolId',schoolId);if(groupId)p.set('groupId',groupId);return cached(`/students${p.toString()?`?${p}`:''}`)};
export const createStudent=async body=>{const d=await api('/students',{method:'POST',body:JSON.stringify(body)});invalidate('/students');invalidate('/schools');return d};
export const history=plate=>api(`/history?plate=${encodeURIComponent(plate)}`);
