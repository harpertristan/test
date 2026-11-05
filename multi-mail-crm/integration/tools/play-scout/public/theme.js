const root=document.documentElement;
let theme='violet';
try{
 const saved=localStorage.getItem('playScoutTheme');
 if(localStorage.getItem('playScoutThemeDefault')==='violet-v1'&&['light','dark','violet'].includes(saved))theme=saved;
 localStorage.setItem('playScoutTheme',theme);
 localStorage.setItem('playScoutThemeDefault','violet-v1');
}catch{}
const label=document.createElement('label');label.className='theme-switch';label.textContent='Оформление ';
const select=document.createElement('select');select.className='theme-toggle';select.setAttribute('aria-label','Оформление Play Scout');
for(const [value,text] of [['light','Обычное'],['dark','Ночной режим'],['violet','Фиолетовое']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}label.append(select);
const hero=document.createElement('section');hero.className='scout-violet-banner';hero.setAttribute('aria-label','Play Scout — исследование провайдеров');
const eyebrow=document.createElement('span');eyebrow.textContent='PLAY SCOUT · RESEARCH WORKSPACE';const title=document.createElement('h2');title.textContent='Найти. Проверить. Выбрать.';const description=document.createElement('p');description.textContent='Провайдеры, документы и регистрации — в одном рабочем пространстве.';hero.append(eyebrow,title,description);
(document.querySelector('.page')||document.querySelector('main')||document.body).prepend(hero);
function paint(){root.dataset.theme=theme;select.value=theme;}
select.addEventListener('change',()=>{theme=select.value;try{localStorage.setItem('playScoutTheme',theme);}catch{}paint();});
paint();const host=document.querySelector('.topbar')??document.querySelector('.sidebar');if(!host)label.classList.add('theme-floating');(host??document.body).append(label);
fetch('/api/access').then(response=>response.ok?response.json():null).then(access=>{
 if(!access?.workspace?.enabled)return;
 const nav=document.createElement('nav');nav.className='suite-tabs';nav.setAttribute('aria-label','Разделы рабочего пространства');
 for(const [href,text] of [['/crm','Play Scout'],['/assistant/','Помощник регистраций']]){const link=document.createElement('a');link.href=href;link.textContent=text;if(href==='/crm')link.setAttribute('aria-current','page');nav.append(link);}
 if(host)host.insertAdjacentElement('afterend',nav);else document.body.prepend(nav);
}).catch(()=>{});
