(()=>{

  function roots(){
    const found=[document];for(let i=0;i<found.length&&i<100;i++)for(const el of found[i].querySelectorAll('*'))if(el.shadowRoot&&!el.closest('[data-registration-assistant],[data-registration-assistant-overlay]'))found.push(el.shadowRoot);
    return found;
  }
  const deepQuery=selector=>roots().flatMap(root=>[...root.querySelectorAll(selector)]);
  const normalize=value=>String(value||'').replace(/([a-z\d])([A-Z])/g,'$1 $2').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  function text(node){if(!node)return '';const copy=node.cloneNode(true);copy.querySelectorAll?.('input,select,textarea,button,script,style').forEach(control=>control.remove());return copy.textContent.replace(/\s+/g,' ').trim().slice(0,350);}
  function labelText(node){const copy=node.cloneNode(true);copy.querySelectorAll('small,.help-block,.form-text,[class*="description"]').forEach(n=>n.remove());return text(copy);}
  function labels(control){return [...(control.labels||[])].map(labelText).join(' ').replace(/\s*\*\s*$/,'').trim()||control.getAttribute('aria-label')||(control.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>text(control.getRootNode().getElementById?.(id)||document.getElementById(id))).join(' ').trim();}
  const captionPattern=/^(?:address\s*line\s*[12]|line\s*[12]|town\s*[/ ]\s*city|town|city|post\s*code|postal\s*code|zip(?:\s*code)?|country(?:\s*code)?|dial(?:l?ing)?\s*code|phone\s*number|tin|vat|mm[-/]dd[-/]yyyy|dd[-/.]mm[-/.]yyyy)\s*\*?$/i;
  function caption(control){
    const candidates=(control.getAttribute('aria-describedby')||'').split(/\s+/).map(id=>text(control.getRootNode().getElementById?.(id)||document.getElementById(id)));
    for(const sibling of [control.nextElementSibling,control.previousElementSibling])if(sibling&&!sibling.querySelector('input,select,textarea'))candidates.push(text(sibling));
    for(let container=control.parentElement,depth=0;container&&container.tagName!=='FORM'&&depth<4;container=container.parentElement,depth++){
      if(container.querySelectorAll('input:not([type=hidden]),select,textarea').length!==1)break;
      for(const node of container.querySelectorAll('small,label,.form-text,.help-block,.description,[class*="caption"],.control-label'))candidates.push(text(node));
    }
    return candidates.find(candidate=>captionPattern.test(candidate||''))||'';
  }
  function addressKind(value){const label=normalize(value);if(/\bsame\b|\bcopy\b|^is |^are /.test(label))return;
    if(/^(?:registered(?: office| company| business)?|legal) address$|^юридический адрес$/.test(label))return 'registered';
    if(/^(?:operating|business operating|physical(?: business)?|trading|company trading|business trading|business) address$|^principal place of business$|^адрес деятельности$/.test(label))return 'operating';
    if(/^(?:residential|home|personal|director s?) address$|^адрес проживания$/.test(label))return 'contact';
  }
  function group(control){
    const direct=labels(control),own=addressKind(direct);if(own)return {kind:own,label:direct};
    let context;
    for(let parent=control.parentElement,depth=0;parent&&depth<7;parent=parent.parentElement,depth++){
      if(parent.tagName==='FORM')break;
      for(let previous=control===parent?null:parent.previousElementSibling,count=0;previous&&count<3;previous=previous.previousElementSibling,count++){const value=text(previous),kind=addressKind(value);if(kind)return {kind,label:value};}
      const headings=parent.querySelectorAll(':scope > label,:scope > legend,:scope > h2,:scope > h3,:scope > h4,:scope > .section-title');
      for(const heading of headings){const value=text(heading),kind=addressKind(value);if(kind)return {kind,label:value};if(!context&&/company details|contact details|director|beneficiar|phone number/i.test(value))context=value;}
    }
    const form=control.closest('form')||control.getRootNode();let selected;
    for(const heading of form.querySelectorAll('label,legend,h1,h2,h3,h4,h5,h6,p,.section-title')){
      if(!(heading.compareDocumentPosition(control)&Node.DOCUMENT_POSITION_FOLLOWING))continue;
      const bounded=heading.closest('section,fieldset,.formio-component-address,[data-address-block]');if(bounded&&!bounded.contains(control))continue;
      const value=text(heading),kind=addressKind(value);if(kind)selected={kind,label:value};
      else if(/^H[234]$/.test(heading.tagName)&&/personal|director|beneficiar|company details|contact details/i.test(value)){selected=undefined;context=value;}
    }
    return selected||{label:context||''};
  }
  function eligible(control){return !control.disabled&&!control.readOnly&&!['hidden','submit','button','reset','file','image','password'].includes(control.type)&&control.getClientRects().length&&getComputedStyle(control).visibility!=='hidden';}
  function describe(control,id){
    const direct=labels(control),hint=caption(control),section=group(control),label=direct||hint||control.getAttribute('placeholder')||control.name||'';
    const form=control.closest('form')||control.getRootNode(),peers=[...form.querySelectorAll('input,select,textarea')].slice(0,150);
    const explicitDial=peers.some(peer=>/^(?:dial(?:l?ing)? code|calling code|phone country code|country calling code)$/.test(normalize(labels(peer)||caption(peer))));
    let phoneGroup=false;
    for(let parent=control.parentElement,depth=0;parent&&parent.tagName!=='FORM'&&depth<5;parent=parent.parentElement,depth++){
      const controls=[...parent.querySelectorAll('input:not([type=hidden]),select,textarea')];if(controls.length>4)break;
      if(controls.some(peer=>/^(?:country code|dial code|calling code)$/.test(normalize(caption(peer)||labels(peer))))&&controls.some(peer=>/^(?:phone number|telephone number)$/.test(normalize(caption(peer)||labels(peer)))))phoneGroup=true;
    }
    const local=normalize(hint||label),phonePart=/^(?:country code|dial code|calling code)$/.test(local)&&(phoneGroup||explicitDial)?'dial':/^(?:phone number|telephone number)$/.test(local)&&(phoneGroup||explicitDial)?'national':undefined;
    const taxControl=peers.find(peer=>peer.tagName==='SELECT'&&/^(?:country of tax residence|country of tax residency|tax residence country|tax residency)$/.test(normalize(labels(peer)||caption(peer)||peer.name)));
    let taxCountry;if(taxControl){const option=taxControl.selectedOptions[0];if(option&&!/^(?:please select|select|choose)/i.test(option.textContent.trim())&&taxControl.value)taxCountry=/^[A-Z]{2}$/i.test(taxControl.value)?taxControl.value:option.textContent.trim().slice(0,80);}
    const kinds=new Set([...form.querySelectorAll('label,legend,h2,h3,.section-title')].map(node=>addressKind(text(node))).filter(Boolean));
    return {id,label:label.slice(0,300),caption:hint,group:section.label||'',addressKind:section.kind,ambiguousAddress:!section.kind&&kinds.size>1,name:(control.name||'').slice(0,100),type:control.tagName==='SELECT'?control.type:control.tagName==='TEXTAREA'?'textarea':control.type,autocomplete:(control.autocomplete||'').split(' ').at(-1),placeholder:control.getAttribute('placeholder')||control.getAttribute('data-date-format')||'',required:control.required,disabled:control.disabled===true||control.getAttribute('aria-disabled')==='true',readOnly:control.readOnly===true,pattern:control.getAttribute('pattern')||'',accept:control.getAttribute('accept')||'',maxLength:control.maxLength,phonePart,splitPhone:phonePart==='national',taxCountry,options:control.tagName==='SELECT'?[...control.options].slice(0,500).map(option=>({text:option.textContent.trim().slice(0,200),value:option.value.slice(0,200),selected:option.selected,disabled:option.disabled})):undefined};
  }
  const optionSelector='button,[role="radio"],[role="checkbox"],[role="switch"],input[type="radio"],input[type="checkbox"],label:has(input[type="radio"]),label:has(input[type="checkbox"])';
  const action=/^(?:(?:show|view|see|learn more)\b.*|continue|next|back|cancel|submit|save|sign in|log in|register|upload|delete|remove|add|edit|close|open|search|далее|назад|продолжить|отмена|сохранить|отправить|загрузить)(?:\s*[→←›»…]*)?$/i;
  function visible(node){return node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('nav,header,[role="navigation"],[role="menu"],[hidden],[aria-hidden="true"]');}
  function optionText(node){return (node.getAttribute('aria-label')||(node.matches('input')?labels(node):node.textContent)||'').replace(/^[\s✓✔☑]+/,'').replace(/\s+/g,' ').trim().slice(0,200);}
  function selected(node){
    if(node.matches('input'))return node.checked;if(node.matches('label'))return node.querySelector('input')?.checked??null;
    for(const attribute of ['aria-checked','aria-pressed','aria-selected']){const value=node.getAttribute(attribute);if(value==='true')return true;if(value==='false')return false;}
    const state=node.getAttribute('data-state');if(['checked','on','selected','active'].includes(state))return true;if(['unchecked','off','unselected','inactive'].includes(state))return false;
    if(/(?:^|\s)(?:selected|checked|is-selected|is-checked)(?:\s|$)/.test(node.className||'')||/^[\s]*[✓✔☑]/.test(node.textContent||'')||node.querySelector('[data-icon="check"],.lucide-check,.fa-check'))return true;
    return null;
  }
  function optionsIn(container){return [...container.querySelectorAll(optionSelector)].filter(node=>visible(node)&&!(node.matches('input')&&node.closest('label'))&&!node.parentElement?.closest('button,[role="radio"],[role="checkbox"],[role="switch"]')).filter(node=>{const value=optionText(node);return value&&value.length<=200&&!action.test(value)&&!node.matches('[type="submit"],[type="reset"],[role="combobox"],[aria-haspopup="listbox"]');});}
  function questionLabel(container){
    const accessible=container.getAttribute('aria-label')||(container.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>text(container.getRootNode().getElementById?.(id)||document.getElementById(id))).join(' ').trim();if(accessible)return accessible;
    const titles=[...container.querySelectorAll(':scope > legend,:scope > label,:scope > h3,:scope > h4,:scope > h5,:scope > .question-label,:scope > .question-title,:scope > .field-label,:scope > .label,:scope > [data-question-label]')].filter(node=>!node.matches('label:has(input[type=radio]),label:has(input[type=checkbox])'));
    if(titles.length===1)return labelText(titles[0]);if(titles.length>1)return '';
    const prompts=[...container.querySelectorAll(':scope > p,:scope > h2,:scope > div > p')].map(node=>text(node)).filter(value=>value.length<=300&&/select|choose|identify|indicate|which|what|position|выбер|укаж/i.test(value));if(prompts.length)return prompts.at(-1);
    const copy=container.cloneNode(true);copy.querySelectorAll(optionSelector+',select,textarea,input,svg,script,style,small,.help-block,.form-text').forEach(node=>node.remove());
    const value=copy.textContent.replace(/\s+/g,' ').trim();return value.length<=350?value:'';
  }
  const consent=/\b(?:i (?:have |hereby )?(?:agree|accept|confirm|certify|consent|acknowledge|reviewed)|terms\s*(?:and|&)\s*conditions|pricing terms|privacy policy)\b/i;
  function choiceDescriptor(container,id){
    if(!visible(container)||['FORM','BODY','MAIN','HTML'].includes(container.tagName))return;
    const other=[...container.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]),select,textarea,[role="combobox"]')];if(other.length>1||other.some(node=>!node.matches('input')||!(node.type==='search'||/search|filter|поиск/i.test(node.getAttribute('placeholder')||''))))return;
    const controls=optionsIn(container);if(controls.length<2||controls.length>300||controls.some(node=>consent.test(optionText(node))))return;
    const question=questionLabel(container).replace(/\s*\*\s*$/,'').trim();if(!question||question.length<5||action.test(question))return;
    if(controls.some(node=>node.matches('input[type="radio"]'))&&new Set(controls.filter(node=>node.matches('input[type="radio"]')).map(node=>node.name)).size>1)return;
    const options=controls.map(node=>({text:optionText(node),selected:selected(node),disabled:node.disabled===true||node.querySelector('input')?.disabled===true||node.getAttribute('aria-disabled')==='true'}));
    if(new Set(options.map(option=>option.text)).size<2)return;
    const mode=container.getAttribute('aria-multiselectable')==='true'||controls.some(node=>node.matches('[role="checkbox"],input[type="checkbox"]')||node.querySelector('input[type=checkbox]'))||/multiple selection|select all|select multiple|choose all/i.test(container.textContent)?'multiple':container.matches('[role="radiogroup"]')||controls.some(node=>node.matches('[role="radio"],input[type="radio"]')||node.querySelector('input[type=radio]'))?'single':'unknown';
    const heading=container.closest('fieldset,section,[role="region"]')?.querySelector('legend,h2,h3,.section-title');
    return {id,label:question.slice(0,300),type:'choice-group',required:/\*\s*$/.test(questionLabel(container))||container.getAttribute('aria-required')==='true',help:supportingText(container),group:heading?text(heading):'',choiceMode:mode,selectionKnown:options.some(option=>option.selected===true),options};
  }
  function scrub(value){let result=String(value||'');for(const input of deepQuery('input,textarea')){if(['checkbox','radio','button','submit','reset','hidden'].includes(input.type))continue;if(input.value?.length>=3)result=result.split(input.value).join('[значение скрыто]');}return result.slice(0,800);}
  function supportingText(el){
    const referenced=(el.getAttribute('aria-describedby')||'').split(/\s+/).map(id=>text((el.getRootNode().getElementById?.(id))||document.getElementById(id))).filter(Boolean);
    const container=el.closest('[data-question],.question,.form-group,.field,.form-field')||el.parentElement;
    if(container)for(const node of container.querySelectorAll(':scope > small,:scope > .help-block,:scope > .form-text,:scope > .description,:scope > [role="alert"],:scope > .error-message')){const value=text(node);if(value)referenced.push(value);}
    return [...new Set(referenced.map(scrub))].slice(0,5);
  }
  function pageContext(){
    const headings=[...deepQuery('h1,h2,h3,h4,[role="heading"]')].filter(visible).slice(0,30).map(node=>scrub(text(node)));
    const actions=[...deepQuery('button,[role="button"],input[type="submit"],input[type="button"]')].filter(visible).map(node=>({label:scrub(optionText(node)||node.value||''),kind:node.type==='submit'||/submit|send application|отправить/i.test(optionText(node))?'submit':action.test(optionText(node))?'navigation':'choice-or-action',disabled:node.disabled===true})).filter(row=>row.label).slice(0,60);
    const notices=[...deepQuery('[role="alert"],.error-message,.validation-message,[aria-live="assertive"]')].filter(visible).slice(0,15).map(node=>scrub(text(node)));
    const embedded=[...deepQuery('iframe,frame')].filter(visible).length;
    const shadows=roots().length-1;
    return {headings,actions,notices,unreadEmbeddedFrames:embedded,openShadowRoots:0,readOpenShadowRoots:shadows};
  }
  function describeControl(el,id){
    let field=describe(el,id);
      if(el.matches('[role="checkbox"],[role="switch"],[role="radio"]')&&!el.matches('input'))field={...field,type:el.getAttribute('role')==='radio'?'radio':'checkbox',label:labels(el)||optionText(el),checked:selected(el)};
      else if(el.matches('[role="combobox"],[aria-haspopup="listbox"]')&&!el.matches('select'))field={...field,type:'custom-select',label:labels(el)||questionLabel(el.parentElement)||el.getAttribute('data-placeholder')||'Выбор варианта'};
      else if(!labels(el)&&!caption(el)){
        for(let parent=el.parentElement,depth=0;parent&&depth<3&&!['FORM','BODY','MAIN'].includes(parent.tagName);parent=parent.parentElement,depth++){
          if(parent.querySelectorAll('input:not([type="hidden"]),select,textarea,[role="combobox"]').length!==1)break;
          const label=questionLabel(parent);if(label){field.label=label.slice(0,300);break;}
        }
      }
      if(field.type==='custom-select'){const target=(el.getAttribute('aria-controls')||el.getAttribute('aria-owns')||'').split(/\s+/).map(id=>el.ownerDocument.getElementById(id)).find(Boolean);if(target)field.options=[...target.querySelectorAll('[role=option]')].slice(0,300).map(option=>({text:optionText(option),selected:selected(option),disabled:option.getAttribute('aria-disabled')==='true'}));}
      const links=[...(el.closest('label')||el.parentElement).querySelectorAll('a[href]')].map(a=>a.textContent.trim()).filter(Boolean).slice(0,5);if(links.length)field.linkTitles=links;if(consent.test(field.label))field.consent=true;
    if(['checkbox','radio'].includes(field.type)&&typeof el.checked==='boolean')field.checked=el.checked;
    const help=supportingText(el);if(help.length)field.help=help;if(el.getAttribute('aria-invalid')==='true')field.invalid=true;
    return field;
  }
  function entries(){
    const roots=new Map();
    for(const control of deepQuery(optionSelector)){
      if(!visible(control)||!optionText(control)||action.test(optionText(control)))continue;
      for(let parent=control.parentElement,depth=0;parent&&depth<9;parent=parent.parentElement,depth++){
        if(['FORM','BODY','HTML','MAIN'].includes(parent.tagName))break;
        const field=choiceDescriptor(parent,'');if(field){roots.set(parent,field);break;}
      }
    }
    // Keep the smallest question block; do not merge neighbouring questions into a card.
    for(const root of [...roots.keys()])if([...roots.keys()].some(other=>other!==root&&root.contains(other)))roots.delete(root);
    const result=[...roots].map(([el,field])=>({el,field}));
    for(const el of deepQuery('input,select,textarea,[role="combobox"],[aria-haspopup="listbox"],[role="checkbox"],[role="switch"],[role="radio"]')){
      if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden'||el.closest('[hidden],[aria-hidden="true"]')||(['hidden','submit','button','reset','image','password'].includes(el.type)&&!el.matches('[role=combobox],[aria-haspopup=listbox]'))||[...roots.keys()].some(root=>root.contains(el)))continue;
      const field=describeControl(el,'');
      if(field.label)result.push({el,field});
    }
    result.sort((a,b)=>a.el===b.el?0:a.el.compareDocumentPosition(b.el)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    return result.slice(0,100).map((entry,index)=>({el:entry.el,field:{...entry.field,id:String(index)}}));
  }
  globalThis.RegistrationDOM={roots,label:control=>labels(control)||caption(control)||control.getAttribute('placeholder')||control.name||'',caption,group,describe:describeControl,eligible,entries,pageContext};
})();
