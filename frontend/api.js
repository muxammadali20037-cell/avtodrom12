const API_BASE=window.AVTODROM_API||`${window.location.origin}/api`;
export function setApiBase(url){window.AVTODROM_API=String(url).replace(/\/$/,'')}
export function getToken(){return localStorage.getItem('avtodrom_token')||''}
export function saveAuth(data){localStorage.setItem('avtodrom_token',data.token);localStorage.setItem('avtodrom_user',JSON.stringify(data.user))}
export function logout(){localStorage.removeItem('avtodrom_token');localStorage.removeItem('avtodrom_user')}
export function currentUser(){try{return JSON.parse(localStorage.getItem('avtodrom_user')||'null')}catch{return null}}
export async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};const token=getToken();if(token)headers.Authorization=`Bearer ${token}`;const res=await fetch(`${window.AVTODROM_API||API_BASE}${path}`,{...options,headers});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Server xatosi');return data}
export const login=(username,password)=>api('/auth/login',{method:'POST',body:JSON.stringify({username,password})});
export const register=(fullName,username,password)=>api('/auth/register',{method:'POST',body:JSON.stringify({fullName,username,password})});
export const getSettings=()=>api('/settings');
export const saveSettings=body=>api('/settings',{method:'PUT',body:JSON.stringify(body)});
export const activeSessions=()=>api('/sessions/active');
export const startSession=body=>api('/sessions/start',{method:'POST',body:JSON.stringify(body)});
export const finishSession=(id,body)=>api(`/sessions/${id}/finish`,{method:'POST',body:JSON.stringify(body)});
export const dashboard=()=>api('/dashboard');
export const dailyReport=date=>api(`/reports/daily?date=${encodeURIComponent(date)}`);
export const schools=()=>api('/schools');
export const createSchool=body=>api('/schools',{method:'POST',body:JSON.stringify(body)});
export const groups=schoolId=>api(`/groups${schoolId?`?schoolId=${encodeURIComponent(schoolId)}`:''}`);
export const createGroup=body=>api('/groups',{method:'POST',body:JSON.stringify(body)});
export const students=(schoolId,groupId)=>{const p=new URLSearchParams();if(schoolId)p.set('schoolId',schoolId);if(groupId)p.set('groupId',groupId);return api(`/students${p.toString()?`?${p}`:''}`)};
export const createStudent=body=>api('/students',{method:'POST',body:JSON.stringify(body)});
export const history=plate=>api(`/history?plate=${encodeURIComponent(plate)}`);
