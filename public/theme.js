const root=document.documentElement,media=matchMedia('(prefers-color-scheme: dark)');
let saved;try{saved=localStorage.getItem('playScoutTheme');}catch{}
let dark=saved?saved==='dark':media.matches;
const button=document.createElement('button');button.type='button';button.className='theme-toggle';
function paint(){root.dataset.theme=dark?'dark':'light';button.textContent=dark?'☀ Светлый режим':'☾ Ночной режим';button.setAttribute('aria-label','Ночной режим');button.setAttribute('aria-pressed',String(dark));}
button.onclick=()=>{dark=!dark;saved=dark?'dark':'light';try{localStorage.setItem('playScoutTheme',saved);}catch{}paint();};
media.addEventListener('change',e=>{if(!saved){dark=e.matches;paint();}});
paint();const host=document.querySelector('.topbar')??document.querySelector('.sidebar');if(!host)button.classList.add('theme-floating');(host??document.body).append(button);
