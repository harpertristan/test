(()=>{
  const normalize=value=>String(value||'').replace(/([a-z\d])([A-Z])/g,'$1 $2').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  function text(node){if(!node)return '';const copy=node.cloneNode(true);copy.querySelectorAll?.('input,select,textarea,button,script,style').forEach(control=>control.remove());return copy.textContent.replace(/\s+/g,' ').trim().slice(0,350);}
  function labels(control){return [...(control.labels||[])].map(text).join(' ').replace(/\s*\*\s*$/,'').trim()||control.getAttribute('aria-label')||(control.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>text(document.getElementById(id))).join(' ').trim();}
  const captionPattern=/^(?:address\s*line\s*[12]|line\s*[12]|town\s*[/ ]\s*city|town|city|post\s*code|postal\s*code|zip(?:\s*code)?|country(?:\s*code)?|dial(?:l?ing)?\s*code|phone\s*number|tin|vat|mm[-/]dd[-/]yyyy|dd[-/.]mm[-/.]yyyy)\s*\*?$/i;
  function caption(control){
    const candidates=(control.getAttribute('aria-describedby')||'').split(/\s+/).map(id=>text(document.getElementById(id)));
    for(const sibling of [control.nextElementSibling,control.previousElementSibling])if(sibling&&!sibling.querySelector('input,select,textarea'))candidates.push(text(sibling));
    for(let container=control.parentElement,depth=0;container&&container.tagName!=='FORM'&&depth<4;container=container.parentElement,depth++){
      if(container.querySelectorAll('input:not([type=hidden]),select,textarea').length!==1)break;
      for(const node of container.querySelectorAll('small,label,.form-text,.help-block,.description,[class*="caption"],.control-label'))candidates.push(text(node));
    }
    return candidates.find(candidate=>captionPattern.test(candidate||''))||'';
  }
  function addressKind(value){const label=normalize(value);if(/\bsame\b|\bcopy\b|^is |^are /.test(label))return;
    if(/^(?:registered(?: office| company| business)?|legal) address$|^юридический адрес$/.test(label))return 'registered';
    if(/^(?:operating|business operating|physical(?: business)?|trading|business) address$|^principal place of business$|^адрес деятельности$/.test(label))return 'operating';
    if(/^(?:residential|home|personal|director s?) address$|^адрес проживания$/.test(label))return 'contact';
  }
  function group(control){
    const direct=labels(control),own=addressKind(direct);if(own)return {kind:own,label:direct};
    let context;
    for(let parent=control.parentElement,depth=0;parent&&depth<7;parent=parent.parentElement,depth++){
      if(parent.tagName==='FORM')break;
      const headings=parent.querySelectorAll(':scope > label,:scope > legend,:scope > h2,:scope > h3,:scope > h4,:scope > .section-title');
      for(const heading of headings){const value=text(heading),kind=addressKind(value);if(kind)return {kind,label:value};if(!context&&/company details|contact details|director|beneficiar|phone number/i.test(value))context=value;}
    }
    const form=control.closest('form')||document;let selected;
    for(const heading of form.querySelectorAll('label,legend,h2,h3,h4,.section-title')){
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
    const form=control.closest('form')||document,peers=[...form.querySelectorAll('input,select,textarea')].slice(0,150);
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
    return {id,label:label.slice(0,300),caption:hint,group:section.label||'',addressKind:section.kind,ambiguousAddress:!section.kind&&kinds.size>1,name:(control.name||'').slice(0,100),type:control.tagName==='SELECT'?control.type:control.tagName==='TEXTAREA'?'textarea':control.type,autocomplete:(control.autocomplete||'').split(' ').at(-1),placeholder:control.getAttribute('placeholder')||control.getAttribute('data-date-format')||'',required:control.required,maxLength:control.maxLength,phonePart,splitPhone:phonePart==='national',taxCountry,options:control.tagName==='SELECT'?[...control.options].slice(0,500).map(option=>({text:option.textContent.trim().slice(0,200),value:option.value.slice(0,200),disabled:option.disabled})):undefined};
  }
  globalThis.RegistrationDOM={label:control=>labels(control)||caption(control)||control.getAttribute('placeholder')||control.name||'',caption,group,describe,eligible};
})();
