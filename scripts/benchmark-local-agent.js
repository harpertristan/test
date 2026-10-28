import {llamaCppProvider} from '../lib/llamacpp-provider.js';
import {validateAssessment} from '../lib/ai-review.js';
const cases=[
 {name:'Компания · немецкий IBAN',expected:'match',text:'Acme offers business accounts for companies. Open a business account with a German IBAN through our licensed EMI partner.'},
 {name:'Только EUR / SEPA',expected:'review',text:'Acme offers business accounts for companies. Send EUR and SEPA transfers. IBAN country is not stated.'},
 {name:'GB IBAN',expected:'review',text:'Acme offers business accounts for companies. Get your business GB IBAN. No EU IBAN is offered.'},
 {name:'IBAN-чекер',expected:'irrelevant',text:'Acme is an IBAN checker and validator. This utility only validates existing bank details. We do not offer customer accounts.'},
 {name:'Лист ожидания',expected:'review',text:'Acme plans business accounts with a German IBAN. Join the waitlist. Accounts are not live or available yet.'}
];
try{
 const args=process.argv.slice(2);let endpoints=['http://127.0.0.1:8081'],model='qwen2.5-3b-instruct-q4_k_m';
 while(args.length){const key=args.shift(),value=args.shift();if(!value)throw Error('Укажите --endpoints URL,URL и --model ALIAS.');if(key==='--endpoints')endpoints=value.split(',');else if(key==='--model')model=value;else throw Error('Неизвестный параметр.');}
 const provider=llamaCppProvider({endpoints,model}),status=await provider.status({signal:AbortSignal.timeout(5000)});if(!status.ok)throw Error('Не все GPU-серверы отвечают с указанным alias: '+JSON.stringify(status.workers));
 const start=Date.now(),results=[];let cursor=0;
 await Promise.all(Array.from({length:Math.min(endpoints.length,cases.length)},async()=>{while(cursor<cases.length){const c=cases[cursor++],documents=[{id:'s1',url:'https://acme.example.eu/',kind:'official_page',text:c.text}],at=Date.now();const answer=await provider.assess({title:'Acme',documents,translateRu:false});const checked=validateAssessment(answer.assessment,documents);results.push({case:c.name,expected:c.expected,decision:checked.decision,correct:checked.decision===c.expected,ms:Date.now()-at,...answer.metrics});}}));
 console.log(JSON.stringify({model,workers:endpoints.length,totalMs:Date.now()-start,correct:results.filter(r=>r.correct).length,total:results.length,results,notice:'Короткая проверка протокола, скорости и пяти примеров. Это не оценка полноты поиска или гарантированного качества на новых банках. Платные API не вызывались.'},null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
