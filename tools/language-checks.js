/* Real-page language acceptance: state continuity, live copy, exports and layout. */
(async function () {
  const fail=[], info=[];
  const $=id=>document.getElementById(id), wait=()=>new Promise(r=>setTimeout(r,250));
  const ok=(v,s)=>{if(!v)fail.push(s);};
  const set=async(id,v)=>{const e=$(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));await wait();};
  const toggle=async()=>{$('languageToggle').click();await wait();};
  const untranslated=()=>{
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n,out=[];
    while(n=w.nextNode())if(!n.parentElement.closest('script,style,noscript,#languageToggle')&&/[\u3400-\u9fff]/.test(n.nodeValue))out.push(n.nodeValue.trim());
    for(const e of document.querySelectorAll('[aria-label],[title],[placeholder],[data-label]')){
      if(e.id==='languageToggle')continue;
      for(const a of ['aria-label','title','placeholder','data-label'])if(/[\u3400-\u9fff]/.test(e.getAttribute(a)||''))out.push(a+':'+e.getAttribute(a));
    }
    return [...new Set(out)];
  };
  const translated=label=>{const left=untranslated();ok(!left.length,label+': untranslated '+left.join(' | '));};
  const state=()=>JSON.stringify([...document.querySelectorAll('input,select')].map(e=>[e.id,e.value,e.checked]));
  document.documentElement.style.scrollBehavior='auto';
  const inputs=state(), stored=localStorage.getItem('ot_calc_v1'), figure=$('heroVal').firstChild, svg=$('mixChart').firstChild;
  const original=document.querySelector('.lede').textContent;
  document.querySelector('#mixLegend button').click();
  const pin=document.querySelector('#mixLegend [aria-pressed="true"]');
  window.scrollTo(0,600);await wait();const y=scrollY;
  await toggle();
  ok(document.documentElement.lang==='en','English lang');
  ok(state()===inputs,'inputs changed on language switch');
  ok(localStorage.getItem('ot_calc_v1')===stored,'language saved calculator data');
  ok(localStorage.getItem('tc_language')==='en','language preference not saved');
  ok($('heroVal').firstChild===figure && $('mixChart').firstChild===svg,'results or chart rebuilt');
  ok(pin.getAttribute('aria-pressed')==='true','pinned slice lost');
  ok(Math.abs(scrollY-y)<=1,'scroll reset on switch');
  translated('initial English');
  ok($('hSlider').getBoundingClientRect().width>=100,'overtime slider track too short');
  for(const precision of [0,2]){
    document.querySelector('[data-prec="'+precision+'"]').click();await wait();
    translated('precision '+precision);
    ok(document.documentElement.scrollWidth<=innerWidth,'page overflow');
    const title=$('topbarTitle'), tools=document.querySelector('.topbar-tools').getBoundingClientRect();
    for(const e of title.querySelectorAll('.tl-total,.tl-take,.tl-rate')){
      ok(e.scrollWidth<=e.clientWidth+1,'clipped header '+e.className);
      ok(e.getBoundingClientRect().right<=tools.left,'header overlaps controls '+e.className);
    }
    ok($('tEff').textContent===document.querySelector('.tl-rate-val').textContent,'header effective tax parity');
  }
  await toggle();ok(document.querySelector('.lede').textContent===original,'Chinese prose changed on round trip');
  ok(document.querySelector('#schedTable th').textContent.includes('加班'),'Chinese table label lost');
  await toggle();
  // Exercise newly rendered text, both IRA phaseout paths, limits and tax errors.
  await set('aBase','95000');await set('cIra','500');translated('IRA partial phaseout, full deduction');
  await set('cIra','7500');translated('IRA partial deduction');
  await set('taxYear','2029');translated('ineligible tax year');
  await set('taxYear','2026');
  document.querySelector('[data-addrow="fed"]').click();await wait();translated('new bracket');
  await set('cIra','50000');await set('c401k','50000');await set('cHsa','20000');translated('contribution warnings');
  await set('aBase','300000');translated('high MAGI');
  await set('aBase','0');translated('invalid salary');
  await set('aHours','0');translated('invalid hours');
  await set('aHours','2080');await set('aBase','100000');
  const top=document.querySelector('#fedBrackets input[data-f="top"]');top.value='';top.dispatchEvent(new Event('input',{bubbles:true}));await wait();translated('invalid bracket');
  const snapshot=AppBridge.snapshot();
  ok(snapshot.includes('lang="en"') && snapshot.includes('Overtime &amp; Total Compensation'),'print language');
  // Capture the production copy path in memory; do not modify the system clipboard.
  let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:t=>{copied=t;return Promise.resolve();}}});
  AppBridge.copyTable();await wait();
  ok(copied.startsWith('Overtime & Total Compensation'),'English export heading');
  ok(!/[\u3400-\u9fff]/.test(copied),'untranslated export: '+copied.split('\n').filter(s=>/[\u3400-\u9fff]/.test(s)).join('|'));
  translated('copy toast');
  await toggle();AppBridge.copyTable();await wait();ok(copied.startsWith('加班与总薪酬测算'),'Chinese export heading');
  info.push({width:innerWidth,checks:'language round trip, continuity, dynamic hints, accessible labels, copy, print, layout'});
  window.__RESULT=JSON.stringify({pass:!fail.length,fail,info});
}()).catch(e=>{window.__RESULT=JSON.stringify({pass:false,fail:[e.stack]});});
