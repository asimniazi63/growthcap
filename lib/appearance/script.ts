import { APPEARANCE_COOKIE, APPEARANCE_EVENT, DEFAULT_APPEARANCE } from "./schemes";

// The script the root layout inlines in <head>. It runs before first paint, for two cases the server cannot see:
// 1. People who chose light or dark before schemes existed have it in localStorage ("oasis-theme"). With no appearance cookie yet,
//    it becomes a cookie (default scheme, that mode) once, so their choice carries over.
// 2. "Match my device": the server cannot know the system setting, so the mode is set here from the device. It is kept in step in
//    two ways, and both act only while the person's choice is "system": when the device changes (a sunset switch), and whenever
//    data-pref or data-mode change on <html>, which also corrects the mode if React re-renders the layout (router.refresh) with the
//    server's "light" for a system choice. A person who has picked Light or Dark is never overridden by the device.
// Only constants are interpolated, never anything from a request.
export function appearanceScript(): string {
  const cookie = APPEARANCE_COOKIE;
  return (
    `try{var d=document.documentElement;` +
    `var has=document.cookie.split("; ").some(function(p){return p.indexOf("${cookie}=")===0});` +
    `if(!has){var t=localStorage.getItem("oasis-theme");if(t==="light"||t==="dark"){` +
    `document.cookie="${cookie}=${DEFAULT_APPEARANCE.scheme}."+t+"; Path=/; Max-Age=31536000; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"");` +
    `d.dataset.pref=t;d.dataset.mode=t}}` +
    `var q=matchMedia("(prefers-color-scheme: dark)");` +
    `var sync=function(){if(d.dataset.pref!=="system")return;var m=q.matches?"dark":"light";` +
    `if(d.dataset.mode!==m){d.dataset.mode=m;window.dispatchEvent(new Event("${APPEARANCE_EVENT}"))}};` +
    `sync();q.addEventListener("change",sync);` +
    `new MutationObserver(sync).observe(d,{attributes:true,attributeFilter:["data-pref","data-mode"]})` +
    `}catch(e){}`
  );
}
